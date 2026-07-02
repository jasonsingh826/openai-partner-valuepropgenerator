// api/generate.js — Vercel serverless function.
// POST { url?, company?, doWhat?, audience?, partnerType? }
// - If `url` is given, the SERVER fetches the site (no CORS limits) and reads it.
// - For AI-written copy it uses whichever key is configured:
//     ANTHROPIC_API_KEY  → Claude   (preferred if both are set)
//     OPENAI_API_KEY     → OpenAI
//   With no key it falls back to a built-in template, so it always returns something.

import {
  extractFields, domainFromUrl, stripHtml,
  fallbackVariants, OPENAI_SYSTEM, buildUserPrompt,
} from '../lib/core.js';

const FETCH_TIMEOUT_MS = 12000;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

async function fetchSite(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ValuePropBot/1.0; +https://openai.com)' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Robustly pull a JSON object out of model text (handles code fences / stray prose).
function extractJson(text = '') {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
}

async function callClaude({ pageText, fields, partnerType }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: OPENAI_SYSTEM,
      messages: [{
        role: 'user',
        content: buildUserPrompt({ pageText, fields, partnerType }) +
          '\n\nReturn ONLY the JSON object — no prose, no code fences.',
      }],
    }),
  });
  if (!res.ok) throw new Error('Anthropic API ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || '').join('');
  return extractJson(text);
}

// Works for any OpenAI-compatible chat API (OpenAI, Groq, OpenRouter, …).
async function callOpenAICompatible({ url, apiKey, model, jsonMode, pageText, fields, partnerType }) {
  const body = {
    model,
    temperature: 0.6,
    messages: [
      { role: 'system', content: OPENAI_SYSTEM },
      {
        role: 'user',
        content: buildUserPrompt({ pageText, fields, partnerType }) +
          '\n\nReturn ONLY the JSON object — no prose, no code fences.',
      },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('API ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content || '{}');
}

const callOpenAI = (args) => callOpenAICompatible({
  url: 'https://api.openai.com/v1/chat/completions',
  apiKey: process.env.OPENAI_API_KEY, model: OPENAI_MODEL, jsonMode: true, ...args,
});

const callGroq = (args) => callOpenAICompatible({
  url: 'https://api.groq.com/openai/v1/chat/completions',
  apiKey: process.env.GROQ_API_KEY, model: GROQ_MODEL, jsonMode: false, ...args,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { url = '', partnerType = 'consultancy' } = body;
    let fields = {
      company: (body.company || '').trim(),
      doWhat: (body.doWhat || '').trim(),
      audience: (body.audience || '').trim(),
    };
    let pageText = '';
    let readError = null;

    if (url) {
      const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
      try {
        const html = await fetchSite(target);
        pageText = stripHtml(html);
        const extracted = extractFields(html, domainFromUrl(target));
        fields = {
          company: fields.company || extracted.company,
          doWhat: fields.doWhat || extracted.doWhat,
          audience: fields.audience || extracted.audience,
        };
      } catch (e) {
        readError = 'Could not read that site (' + e.message + ').';
      }
    }

    // Pick provider by whichever key is set. Built-in template if none.
    const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic'
      : process.env.GROQ_API_KEY ? 'groq'
      : process.env.OPENAI_API_KEY ? 'openai' : null;
    const canRun = provider && (pageText || fields.company);

    let valueProps, source;
    if (canRun) {
      try {
        const ai = provider === 'anthropic' ? await callClaude({ pageText, fields, partnerType })
          : provider === 'groq' ? await callGroq({ pageText, fields, partnerType })
          : await callOpenAI({ pageText, fields, partnerType });
        fields = {
          company: ai.company || fields.company,
          doWhat: ai.doWhat || fields.doWhat,
          audience: ai.audience || fields.audience,
        };
        valueProps = Array.isArray(ai.valueProps) && ai.valueProps.length
          ? ai.valueProps
          : fallbackVariants({ ...fields, partnerType });
        source = provider;
      } catch (e) {
        valueProps = fallbackVariants({ ...fields, partnerType });
        source = 'fallback';
        readError = (readError ? readError + ' ' : '') + 'AI generation unavailable, used built-in template.';
      }
    } else {
      valueProps = fallbackVariants({ ...fields, partnerType });
      source = provider ? 'fallback' : 'fallback-no-key';
    }

    return res.status(200).json({ fields, valueProps, source, readError });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
