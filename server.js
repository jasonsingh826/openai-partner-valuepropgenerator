// server.js — tiny local dev server (no dependencies).
// Run:  node server.js   →   http://localhost:3000
// Production uses Vercel serverless (api/generate.js); this just mirrors it locally.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import handler from './api/generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

function makeRes(res) {
  return {
    setHeader: (k, v) => res.setHeader(k, v),
    status(code) { res.statusCode = code; return this; },
    json(obj) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return this; },
    end() { res.end(); return this; },
  };
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/generate') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const shimReq = { method: req.method, body: raw };
      await handler(shimReq, makeRes(res));
    });
    return;
  }
  // static: index.html
  try {
    const file = await readFile(path.join(__dirname, 'index.html'));
    res.setHeader('Content-Type', 'text/html');
    res.end(file);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`▶  Value Prop Generator running at http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY ? '   OpenAI API key detected — using AI generation.' : '   No OPENAI_API_KEY — using built-in fallback (set one for AI copy).');
});
