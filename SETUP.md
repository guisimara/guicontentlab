# Setup

## Requirements
- Node.js 20+ (tested with Node 24)
- npm

## Install

```bash
cd "/Users/user/Let CONTENT"
npm install
```

`npm install` pulls in `@fontsource/poppins`, `puppeteer` (which downloads a
bundled Chromium into `~/.cache/puppeteer`), `sharp`, and `archiver`.

If Puppeteer's Chromium download ever ends up corrupted/partial (symptom:
`spawn Unknown system error -88` or a missing `Contents/` folder inside the
`.app` bundle on macOS), re-run:

```bash
npx puppeteer browsers install chrome
```

and, on macOS, if Gatekeeper blocks the unsigned Chrome-for-Testing binary,
clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine "$(npx puppeteer browsers path chrome 2>/dev/null || echo ~/.cache/puppeteer)"
```

## Run (dev)

```bash
npm run dev
```

This runs `predev` (`npm run build:fonts`, which generates
`lib/fonts.generated.ts` from the installed Poppins woff2 files) and then
starts Next.js on **http://localhost:3000**.

## Build fonts manually

```bash
npm run build:fonts
```

Regenerates `lib/fonts.generated.ts`. Required once after `npm install`
before any render can succeed (also runs automatically via `predev`/`prebuild`).

## Production build

```bash
npm run build
npm start
```

## Self-test (renders a sample 6-card copy end-to-end)

```bash
npm run selftest
```

Generates placeholder JPEG images with `sharp`, runs the sample copy through
`lib/render.ts` directly (no HTTP), writes PNGs + `report.json` to
`/tmp/jobs/<jobId>/`, and prints the report + QA checklist to stdout.

## Output location

Generated PNGs and `report.json` are written to `/tmp/jobs/<jobId>/` — not
committed, not stored in a database. The dashboard reads job data from the
same in-process API response.
