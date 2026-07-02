// Minimal test runner (no deps):  node test/core.test.js
import assert from 'node:assert';
import { extractFields, fallbackVariants } from '../lib/core.js';
import handler from '../api/generate.js';

let pass = 0, fail = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log('  ✓ ' + name); })
    .catch((e) => { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); });
}

// Realistic fixture modeled on accenture.com's actual markup.
const ACCENTURE_HTML = `<!doctype html><html><head>
<title>About Our Company | Accenture</title>
<meta name="description" content="Accenture solves our clients&#39; toughest challenges by providing unmatched services in strategy &amp; consulting, technology and operations. Learn more." />
<meta property="og:site_name" content="Accenture" />
<meta property="og:description" content="Accenture solves our clients toughest challenges by providing unmatched services in strategy and consulting, technology and operations." />
</head><body>
<h1>Accenture in the United States</h1>
<p>We help the world's leading organizations build their digital core, optimize operations and accelerate growth.</p>
<p>9,000+ clients served across more than 120 countries. 799k employees worldwide.</p>
</body></html>`;

function makeRes() {
  const r = { _code: 0, _json: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r._code = c; return r; };
  r.json = (o) => { r._json = o; return r; };
  r.end = () => r;
  return r;
}
async function invoke(body, { fetchImpl, apiKey } = {}) {
  const prevFetch = global.fetch, prevKey = process.env.OPENAI_API_KEY;
  if (fetchImpl) global.fetch = fetchImpl;
  if (apiKey === null) delete process.env.OPENAI_API_KEY; else if (apiKey) process.env.OPENAI_API_KEY = apiKey;
  const res = makeRes();
  await handler({ method: 'POST', body: JSON.stringify(body) }, res);
  global.fetch = prevFetch; process.env.OPENAI_API_KEY = prevKey;
  return res;
}

(async () => {
  console.log('core.extractFields');
  await test('pulls clean company/doWhat/audience from Accenture markup', () => {
    const f = extractFields(ACCENTURE_HTML, 'accenture.com');
    assert.strictEqual(f.company, 'Accenture');
    assert.ok(/strategy/i.test(f.doWhat), 'doWhat should mention strategy: ' + f.doWhat);
    assert.ok(f.audience && !/\d/.test(f.audience), 'audience clean: ' + f.audience);
  });

  console.log('core.fallbackVariants');
  await test('produces 3 clean variants with correct motion, no undefined', () => {
    const v = fallbackVariants({ company: 'Northwind', doWhat: 'claims automation', audience: 'insurers', partnerType: 'si' });
    assert.strictEqual(v.length, 3);
    const all = JSON.stringify(v);
    assert.ok(!/undefined/.test(all), 'no undefined');
    assert.ok(/integrates and scales/.test(all), 'SI motion present');
  });

  console.log('api/generate handler');
  await test('URL path, no API key → reads site, returns 3 fallback props', async () => {
    const res = await invoke(
      { url: 'accenture.com', partnerType: 'si' },
      { apiKey: null, fetchImpl: async () => ({ ok: true, status: 200, text: async () => ACCENTURE_HTML }) }
    );
    assert.strictEqual(res._code, 200);
    assert.strictEqual(res._json.fields.company, 'Accenture');
    assert.strictEqual(res._json.valueProps.length, 3);
    assert.strictEqual(res._json.source, 'fallback-no-key');
    assert.ok(!res._json.readError, 'no read error on success');
  });

  await test('URL fetch fails → still returns props with a readError', async () => {
    const res = await invoke(
      { url: 'brokensite.example', partnerType: 'reseller' },
      { apiKey: null, fetchImpl: async () => { throw new Error('ENOTFOUND'); } }
    );
    assert.strictEqual(res._code, 200);
    assert.ok(res._json.readError, 'should report read error');
    assert.strictEqual(res._json.valueProps.length, 3);
  });

  await test('manual fields only (no url) → composes props', async () => {
    const res = await invoke(
      { company: 'Globex', doWhat: 'supply-chain software', audience: 'manufacturers', partnerType: 'isv' },
      { apiKey: null }
    );
    assert.strictEqual(res._code, 200);
    assert.ok(/Globex/.test(JSON.stringify(res._json.valueProps)));
    assert.ok(/builds and ships/.test(JSON.stringify(res._json.valueProps)));
  });

  await test('OPTIONS preflight returns 204', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS' }, res);
    assert.strictEqual(res._code, 204);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
