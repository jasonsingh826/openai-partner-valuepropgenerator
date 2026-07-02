# Partner × OpenAI — Value Proposition Generator

A tiny web app for OpenAI partner/marketing teams. Enter a partner's website and get a
value proposition for their partnership with OpenAI — read on the **server**, so it works
for any public URL (no browser CORS limits).

- **Frontend:** one static `index.html` (no build step).
- **Backend:** one serverless function, `api/generate.js`.
- **Generation:** uses **Claude (Anthropic API)** when `ANTHROPIC_API_KEY` is set, or the
  **OpenAI API** when `OPENAI_API_KEY` is set; otherwise falls back to a built-in template so
  it always returns something usable.

---

## How it works

1. You enter a partner URL (e.g. `accenture.com`).
2. The serverless function fetches that page and extracts the company, what they do, and who
   they serve.
3. It returns three value propositions — *Value exchange*, *Partnership-led*, *Outcome-led* —
   that combine the partner's value with OpenAI's enterprise value (frontier models + agentic
   tools + enterprise-grade trust + measurable results).
4. Every field is editable; tweak and regenerate any time.

The OpenAI side of the messaging is anchored to OpenAI's enterprise positioning, and the copy
follows OpenAI's brand rules (uses "powered by"/"built on", never implies an official
partnership unless one exists).

---

## Run locally

Requires **Node 18+** (for built-in `fetch`). No dependencies to install.

```bash
# optional: enable AI-written copy
cp .env.example .env        # then paste your key into ANTHROPIC_API_KEY (or OPENAI_API_KEY)
# load it into your shell (or use a tool like dotenv / direnv)
export $(grep -v '^#' .env | xargs)

npm run dev                 # → http://localhost:3000
```

Without a key it still runs — it just uses the built-in template instead of the OpenAI API.

Run the tests:

```bash
npm test
```

---

## Deploy to Vercel (recommended)

1. Push this folder to a GitHub repo.
2. In [Vercel](https://vercel.com/new), **Import** the repo. No framework preset / build
   command needed — it deploys the static page and the `api/` function automatically.
3. (Optional but recommended) In **Project → Settings → Environment Variables**, add ONE:
   - `ANTHROPIC_API_KEY` — your Claude/Anthropic key (and optionally `ANTHROPIC_MODEL`, defaults to `claude-sonnet-4-6`), **or**
   - `OPENAI_API_KEY` — your OpenAI key (and optionally `OPENAI_MODEL`, defaults to `gpt-4o-mini`)
4. Deploy. Your app is live at `https://<your-project>.vercel.app`.

> The serverless function runs server-side, so it can fetch any public partner site —
> this is the part a plain static page can't do.

---

## Project structure

```
.
├── index.html            # frontend (static, no build)
├── api/
│   └── generate.js        # serverless function: fetch site → OpenAI or fallback
├── lib/
│   └── core.js            # extraction + value-prop composition (shared, testable)
├── test/
│   └── core.test.js       # node test runner (no deps)
├── server.js              # local dev server mirroring the Vercel function
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

---

## Notes & guardrails

- Output is a **draft**. Review for accuracy and get approval before external use.
- Don't imply an official OpenAI partnership unless one exists.
- Confirm OpenAI product/model names before publishing — they change over time.
- The app sends the partner's public page text and your chosen partner type to the OpenAI
  API (only when a key is configured). No data is stored by this app.
