// api/generate.js — Vercel serverless function.
// POST { url?, company?, doWhat?, audience?, partnerType? }
// - If `url` is given, the SERVER fetches the site (no CORS limits) and reads it.
// - If OPENAI_API_KEY is set, OpenAI writes the value props; otherwise a built-in
//   fallback composes them. Either way you always get a usable result.

import {
  extractFields, domainFromUrl, stripHtml,
  fallbackVariants, OPENAI_SYSTEM, buildUserPrompt,
} from '../lib/core.js';

const FETCH_TIMEOUT_MS = 12000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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

async function callOpenAI({ pageText, fields, partnerType }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: OPENAI_SYSTEM },
        { role: 'user', content: buildUserPrompt({ pageText, fields, partnerType }) },
      ],
    }),
  });
  if (!res.ok) throw new Error('OpenAI API ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

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
        // Manual fields (if provided) win over extracted ones.
        fields = {
          company: fields.company || extracted.company,
          doWhat: fields.doWhat || extracted.doWhat,
          audience: fields.audience || extracted.audience,
        };
      } catch (e) {
        readError = 'Could not read that site (' + e.message + ').';
      }
    }

    const useOpenAI = !!process.env.OPENAI_API_KEY && (pageText || fields.company);
    let valueProps, source;
    if (useOpenAI) {
      try {
        const ai = await callOpenAI({ pageText, fields, partnerType });
        fields = {
          company: ai.company || fields.company,
          doWhat: ai.doWhat || fields.doWhat,
          audience: ai.audience || fields.audience,
        };
        valueProps = Array.isArray(ai.valueProps) && ai.valueProps.length
          ? ai.valueProps
          : fallbackVariants({ ...fields, partnerType });
        source = 'openai';
      } catch (e) {
        valueProps = fallbackVariants({ ...fields, partnerType });
        source = 'fallback';
        readError = (readError ? readError + ' ' : '') + 'AI generation unavailable, used built-in template.';
      }
    } else {
      valueProps = fallbackVariants({ ...fields, partnerType });
      source = process.env.OPENAI_API_KEY ? 'fallback' : 'fallback-no-key';
    }

    return res.status(200).json({ fields, valueProps, source, readError });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
