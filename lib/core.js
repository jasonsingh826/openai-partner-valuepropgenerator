// core.js — shared, dependency-free logic used by the API and tests.
// Two jobs: (1) pull clean fields out of a partner's website HTML,
// (2) compose value propositions (deterministic fallback when no OpenAI key).

/* ---------------- HTML / text helpers ---------------- */

export function stripHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, re) {
  const m = html.match(re);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&apos;/g, "'").trim() : '';
}

export function getMeta(html = '') {
  return {
    title: metaContent(html, /<title[^>]*>([^<]+)<\/title>/i),
    description: metaContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || metaContent(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i),
    ogTitle: metaContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    ogDesc: metaContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    ogSite: metaContent(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i),
  };
}

const cap = (s = '') => s.replace(/\b\w/g, (c) => c.toUpperCase());
const lc1 = (s = '') => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/* ---------------- field extraction ---------------- */

export function domainFromUrl(url = '') {
  return String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
}

function guessCompany(meta, dom) {
  if (meta.ogSite) return meta.ogSite;
  const fromDomain = cap(dom.split('.')[0].replace(/[-_]/g, ' '));
  // If the title contains the domain word, prefer that exact casing segment.
  const segs = (meta.title || meta.ogTitle || '').split(/[|–—\-:·]/).map((s) => s.trim()).filter(Boolean);
  const match = segs.find((s) => s.toLowerCase().replace(/[^a-z0-9]/g, '') === dom.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, ''));
  return match || fromDomain;
}

function guessDoWhat(meta, text, company) {
  const src = meta.description || meta.ogDesc || text.slice(0, 400);
  if (!src) return '';
  let s = src.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '').trim();
  // drop "[Company] solves/provides/helps/is a ..." opener
  if (company) s = s.replace(new RegExp('^' + company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['’]?s?\\s+", 'i'), '').trim();

  let phrase = '';
  // "...services/solutions/expertise/consulting in|for|across <X>"
  let m = s.match(/\b(?:services?|solutions?|expertise|consulting|products?)\s+(?:in|for|across|to)\s+(.+)$/i);
  if (m) phrase = m[1];
  // "provides/delivers/offers/builds/specializes in <X>"
  if (!phrase) { m = s.match(/\b(?:provid\w*|deliver\w*|offer\w*|specializ\w*(?:\s+in)?|builds?|designs?|creates?|enables?)\s+(.+)$/i); if (m) phrase = m[1]; }
  if (!phrase) phrase = s.replace(/^(we|our|that|a|an|the)\s+/i, '');

  phrase = phrase.replace(/^(unmatched|leading|innovative|best-in-class|world-class|cutting-edge|comprehensive)\s+/i, '').trim();
  if (phrase.length > 90) phrase = phrase.slice(0, 90).replace(/\s+\S*$/, '') + '…';
  return lc1(phrase);
}

function guessAudience(meta, text) {
  const hay = (meta.description + ' ' + meta.ogDesc + ' ' + text).slice(0, 4000);
  const m = hay.match(/\b(?:for|serving|helps?|serve|trusted by|work with)\s+([a-z][\w\s&-]{4,38}?)(?:\.|,| to | with | by | that | who | build| across|$)/i);
  if (m && !/\d/.test(m[1])) return m[1].trim();
  const segs = ['enterprises', 'businesses', 'companies', 'organizations', 'organisations', 'brands', 'retailers', 'banks', 'insurers', 'manufacturers', 'teams', 'agencies', 'startups', 'marketers', 'developers', 'customers', 'clients'];
  const seg = segs.find((s) => new RegExp('\\b' + s + '\\b', 'i').test(hay));
  return seg || 'enterprises';
}

export function extractFields(html = '', dom = '') {
  const meta = getMeta(html);
  const text = stripHtml(html);
  const company = guessCompany(meta, dom);
  return {
    company,
    doWhat: guessDoWhat(meta, text, company) || 'enterprise solutions',
    audience: guessAudience(meta, text),
  };
}

/* ---------------- value proposition composition ---------------- */

const MOTION = {
  consultancy: 'designs and launches',
  si: 'integrates and scales',
  reseller: 'brings to market',
  isv: 'builds and ships',
};

export function fallbackVariants({ company, doWhat, audience, partnerType }) {
  const c = (company || 'The partner').trim();
  const w = (doWhat || 'enterprise solutions').trim();
  const a = (audience || 'enterprises').trim();
  const motion = MOTION[partnerType] || MOTION.consultancy;
  return [
    {
      tag: 'Value exchange',
      text: `For ${a} who want to put AI to work, ${c} combines its ${w} with OpenAI's most capable frontier models. ${c} brings the expertise and delivery; OpenAI brings enterprise-grade AI, security, and continuous innovation — together turning AI's potential into measurable results.`,
    },
    {
      tag: 'Partnership-led',
      text: `${c} + OpenAI: ${w} powered by the world's most capable AI. ${c} knows your business and ${motion} the solution; OpenAI provides frontier intelligence with the privacy and control enterprises require — so ${a} move faster, securely.`,
    },
    {
      tag: 'Outcome-led',
      text: `With ${c} and OpenAI, ${a} turn frontier AI into real outcomes. ${c} delivers ${w} built on OpenAI's enterprise platform — the most capable models, agentic tools, and enterprise-grade trust — and stands behind every deployment.`,
    },
  ];
}

/* ---------------- OpenAI prompt (used when a key is configured) ---------------- */

export const OPENAI_SYSTEM = `You are a B2B partner-marketing strategist writing value propositions for partners of OpenAI (resellers, agencies, system integrators, and ISVs).

Anchor the OpenAI side of every value proposition in OpenAI's enterprise positioning:
- The most capable, continuously-improving frontier models, plus agentic tools (agents, Custom GPTs, connectors).
- Enterprise-grade trust: business data is not used to train OpenAI's models by default; the customer owns inputs/outputs; SOC 2 Type II, encryption, SSO, and admin controls.
- Real, measurable business results at scale (productivity, ROI); over 1 million businesses build with OpenAI.

Rules:
- Make the PARTNER the hero; OpenAI is the engine behind their results.
- Use "powered by" or "built on" OpenAI. Never imply an official partnership ("partnered with", "collaborated with") unless told one exists.
- No hype, no AGI claims, no promises of perfect accuracy. Keep it credible and outcome-focused.
- Return ONLY valid JSON, no markdown.`;

export function buildUserPrompt({ pageText = '', fields = {}, partnerType = 'consultancy' }) {
  return `Partner type: ${partnerType}
Known fields (may be empty — infer/refine from the website text):
- company: ${fields.company || ''}
- what they do: ${fields.doWhat || ''}
- who they serve: ${fields.audience || ''}

WEBSITE TEXT:
"""
${pageText.slice(0, 6000)}
"""

Return JSON with this exact shape:
{
  "company": "string",
  "doWhat": "short phrase describing what they do",
  "audience": "short phrase describing who they serve",
  "valueProps": [
    { "tag": "Value exchange", "text": "..." },
    { "tag": "Partnership-led", "text": "..." },
    { "tag": "Outcome-led", "text": "..." }
  ]
}`;
}
