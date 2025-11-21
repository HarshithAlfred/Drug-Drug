# Drug-Drug Interaction Explorer

Next.js web application for quickly estimating potential interactions between two medications. The UI mirrors the "design to compy" reference while enhancing it with real data from openFDA and RxNorm plus an internal severity scoring system.

## Features
- **Interactive search experience** – dual autocomplete inputs mixing local word lists with RxNorm suggestions.
- **External interaction analysis** – serverless API route fetches openFDA adverse-event reports and summarizes top reactions.
- **Deterministic severity scoring** – the new `utils/severity.ts` helper scans FDA text for keywords (minor → contraindicated) and normalizes the weight into a 0–100% score.
- **Color-coded feedback** – Severity badges and the About/legend section use the exact palette from the provided design, including gradient hero and animated background.
- **Caching & resiliency** – openFDA responses are cached with `node-cache` to reduce rate-limit hits and keep the UI responsive.

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Create `.env.local`**
   ```bash
   OPENFDA_API_KEY=your_key_here
   CACHE_TTL=3600
   PROVIDER=openfda
   ```
   - Optional overrides: `RXNORM_BASE` for different suggestion endpoints, `LEXIGRAM_API_KEY` if you enable that provider.
3. **Run the dev server**
   ```bash
   npm run dev
   ```
4. **Production build**
   ```bash
   npm run build
   npm run start
   ```

## Severity Mapping
The shared helper exposes:
- `SEVERITY_WEIGHTS`: `{ none:0, minor:1, moderate:2, serious:3, contraindicated:4 }`
- `evaluateSeverityFromTexts()` – scans interaction, warnings, and reaction text for keywords like "life-threatening" or "dose adjustment".
- `weightToPercentage()` – normalizes the numeric tier into a percentage so the UI can display badges (green → red) and textual guidance.

If openFDA does not provide a strong signal, the UI falls back to "No known interaction" with a safe badge.

## Project Structure
- `pages/index.tsx` – hero card, dual inputs, severity block, and About section (static copy from design reference).
- `pages/api/check-external.ts` – POST endpoint that delegates to `lib/provider.ts` and now returns severity metadata.
- `lib/provider.ts` – fetches openFDA data, builds summaries, caches responses, and calls the severity helper.
- `utils/severity.ts` – shared keyword/weight definitions.
- `styles/globals.css` – Tailwind base imports plus bespoke CSS for gradients, button animation, loader pills, and severity table.
- `design to compy/` – source assets (HTML/CSS/JS + `drug.png` favicon, `dna-animated.svg`).

## Deployment Notes

- Because openFDA rate-limits requests, keep `CACHE_TTL` at or above 60 seconds in production.

## Testing & Quality
This repo uses Next.js 14; run `npm run build` to catch type or runtime issues before pushing. Add integration or unit tests as you expand the API surface.

