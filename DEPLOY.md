# Deploying this app (free tiers)

This is a **long‑running Node + Express** service that calls ECI over the network and may launch **headless Chromium**. It does **not** fit serverless hosts that only run short functions (e.g. Vercel / Netlify serverless without a persistent server).

## Recommended: Docker on a free web service

1. Push this repo to **GitHub** (or GitLab).
2. On **[Render](https://render.com)** (free web service): **New +** → **Web Service** → connect the repo → **Runtime: Docker** → deploy.  
   Or use **Blueprint** and point Render at `render.yaml`.
3. Set optional env vars in the dashboard:
   - `ECI_RESULTS_URL` — defaults to the bundled ECI URL if unset.
   - `ECI_PROXY_URL` or `HTTPS_PROXY` — if ECI blocks the host’s IP (residential proxy).
   - `ECI_SKIP_PUPPETEER=1` — skip headless Chrome (less RAM; may fail if Akamai only allows browser-like clients).
   - **`GOOGLE_CSE_API_KEY`** and **`GOOGLE_CSE_CX`** — optional; enables party logos in the table and dashboard via [Programmable Search (Custom Search JSON API)](https://developers.google.com/custom-search/v1/overview) **image** search (one image per distinct party name, cached server-side). If unset, the UI shows text and coloured dots only. **Do not commit API keys**; set them only in the host’s secret/env UI. Free tier is limited (on the order of **100 search queries per day**); each new party name in a load uses one query until the 7‑day server cache expires.

**Google image search setup (short):** In Google Cloud, enable **Custom Search API** and create an **API key**. In [Programmable Search Engine](https://programmablesearchengine.google.com/), create an engine (e.g. search the entire web), turn on **Image search** in its settings, and copy the **Search engine ID** as `GOOGLE_CSE_CX`. Images are third-party links; accuracy is not guaranteed—respect Google’s API terms.

**Free tier caveats:** services often **sleep after idle** (slow first load), **RAM is limited** (512MB on Render free). If the container is killed during fetch, try `ECI_SKIP_PUPPETEER=1` first; if results are then blocked, upgrade RAM or use a proxy.

### Keep-warm / health check

`GET /api/health` returns JSON `{ ok, uptimeSeconds, timestamp }` and does **not** call ECI. You can poll it from a cron job or uptime service (e.g. every 5–10 minutes) so the process stays warm—**some hosts still spin down** when idle regardless, so treat this as best-effort.

## Other hosts that can run this

| Host | Notes |
|------|--------|
| **Railway** | Dockerfile; trial/credits; set `PORT` from platform. |
| **Fly.io** | `fly launch` with same Dockerfile; free allowance is small—watch memory with Chromium. |
| **Koyeb** | Docker web service; free tier limits apply. |
| **Google Cloud Run** | Container; set **min instances = 0** for scale-to-zero; cold starts; increase **memory** if Chromium runs. |
| **Oracle Cloud “Always Free” VM** | Full Ubuntu VM; `git clone`, `npm ci`, `npm run install-browser`, `npm start` behind nginx/Caddy. Most predictable for Chromium. |

## Build without Docker (advanced)

On any Linux VM with Node 20+: `npm ci`, then `npm run install-browser`, then `npm start`. Install system libs Playwright lists if Chromium fails to start.

## Paste / offline HTML

The UI no longer includes paste; the server still accepts **`POST /api/results/raw`** with raw HTML body for automation or local tools.

## `public/election-config.json` (optional)

If this file defines **one or more** keys under `blocs` (up to 24), each with `label`, `parties` (ECI leading-party strings), and `urls` (bloc logo image URLs — the first `https?://` entry is shown in the table and dashboard cards; use direct file URLs or Wikipedia `Special:FilePath/...`), the dashboard aggregates **leading seats by bloc** instead of raw party names. Optional root **`eciUrls`**: array of ECI result page URLs; the app fetches each, merges rows (deduped by state + constituency number + name), and shows one combined view. Parties not listed under any bloc are counted under **`fallbackBloc`** (a bloc key). If the file is missing, `blocs` is empty, or there are more than 24 bloc keys, behaviour falls back to the previous party-level dashboard and a single default URL.
