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
