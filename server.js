const path = require("path");
const dns = require("dns").promises;
const net = require("net");
const express = require("express");
const { parseEciResultsHtml } = require("./lib/parseEci");
const {
  fetchMergedEciResults,
  fetchMergedFromPastedHtml,
} = require("./lib/fetchAllEci");
const { recordHomePageVisit, getVisitCount } = require("./lib/visitCounter");
const { resolvePartySymbolsBatch } = require("./lib/googlePartySymbol");

const DEFAULT_URL =
  process.env.ECI_RESULTS_URL ||
  "https://results.eci.gov.in/ResultAcGenMay2026/statewiseS228.htm";

const PORT = Number(process.env.PORT) || 3000;

function isPrivateIp(ip) {
  if (!ip || net.isIP(ip) === 0) return true;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80:")) return true;
    if (lower === "::1") return true;
  }
  return false;
}

/**
 * @param {string} raw
 * @returns {Promise<string>}
 */
async function assertSafeFetchUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (u.username || u.password) {
    throw new Error("URL must not include credentials");
  }
  const host = u.hostname;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0"
  ) {
    throw new Error("Localhost URLs are not allowed");
  }
  const lookup = await dns.lookup(host, { all: true });
  for (const { address } of lookup) {
    if (isPrivateIp(address)) {
      throw new Error("URL resolves to a disallowed address");
    }
  }
  return u.toString();
}

const app = express();

/** Lightweight liveness for uptime monitors / free-tier keep-warm polling (no ECI I/O). */
app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/stats", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    visitCount: getVisitCount(),
  });
});

/** Count loads of the main HTML page (not assets, not /api/*). */
app.use((req, res, next) => {
  if (req.method === "GET") {
    const p = req.path;
    if (p === "/" || p === "/index.html") {
      try {
        recordHomePageVisit();
      } catch (e) {
        console.error("visit counter:", e && e.message);
      }
    }
  }
  next();
});

app.use(express.json({ limit: "64kb" }));

app.post("/api/party-symbols", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const parties = req.body && req.body.parties;
    if (!Array.isArray(parties)) {
      return res.status(400).json({ ok: false, error: "parties array required" });
    }
    if (parties.length > 40) {
      return res.status(400).json({ ok: false, error: "max 40 parties per request" });
    }
    const { map, configured } = await resolvePartySymbolsBatch(parties);
    res.json({ ok: true, map, googleConfigured: configured });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message || "party symbol lookup failed",
    });
  }
});

const parseRawHtml = express.raw({
  type: () => true,
  limit: 15 * 1024 * 1024,
});

app.post("/api/results/raw", parseRawHtml, async (req, res) => {
  const html =
    req.body instanceof Buffer
      ? req.body.toString("utf8")
      : String(req.body || "");
  if (!html || html.length < 80) {
    res.status(400).json({
      ok: false,
      error: "Body is empty or too short to be ECI HTML.",
    });
    return;
  }

  const refRaw =
    typeof req.query.referenceUrl === "string" && req.query.referenceUrl.trim()
      ? req.query.referenceUrl.trim()
      : DEFAULT_URL;

  try {
    const ref = await assertSafeFetchUrl(refRaw);
    const merged = await fetchMergedFromPastedHtml(html, ref);

    if (merged.rows.length === 0) {
      res.status(400).json({
        ok: false,
        error:
          "No rows found. Check that pasted HTML is a full ECI results page, or pass ?referenceUrl= with the exact page URL you copied from.",
      });
      return;
    }

    res.json({
      ok: true,
      sourceUrl: ref,
      fetchedAt: new Date().toISOString(),
      fetchVia: merged.fetchVia,
      pagesFetched: merged.pagesFetched,
      meta: merged.meta,
      rows: merged.rows,
    });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 400;
    res.status(status).json({
      ok: false,
      error: e.message || "Failed to parse or merge pasted HTML",
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/results", async (req, res) => {
  const raw =
    typeof req.query.url === "string" && req.query.url.trim()
      ? req.query.url.trim()
      : DEFAULT_URL;

  try {
    const url = await assertSafeFetchUrl(raw);
    const merged = await fetchMergedEciResults(url);

    if (merged.rows.length === 0) {
      const err = new Error(
        "No constituency rows after fetching all pagination pages (layout may have changed)."
      );
      err.status = 502;
      throw err;
    }

    res.json({
      ok: true,
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
      fetchVia: merged.fetchVia,
      pagesFetched: merged.pagesFetched,
      meta: merged.meta,
      rows: merged.rows,
    });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    const msg = e.message || "Failed to fetch or parse ECI page";
    let hint =
      "Check the URL and your network. You can set ECI_RESULTS_URL to another public HTML URL.";
    let code = e.code;
    if (e.status === 403) {
      if (code === "ECI_ACCESS_DENIED" || /Access Denied page/i.test(msg)) {
        code = "ECI_ACCESS_DENIED";
        hint =
          "Try: set ECI_PROXY_URL (residential proxy), ensure Chromium is available on the server (Dockerfile), or POST full page HTML to /api/results/raw.";
      } else {
        hint =
          "Run `npm run install-browser` (Chromium) on the host, restart, then retry; or POST HTML to /api/results/raw.";
      }
    }
    res.status(status).json({
      ok: false,
      code: code || undefined,
      sourceUrl: raw,
      error: msg,
      hint,
    });
  }
});

app.listen(PORT, () => {
  console.log(`ECI viewer: http://localhost:${PORT}`);
  console.log(`Default source: ${DEFAULT_URL}`);
  console.log(
    "Fetch chain: axios → got-scraping → puppeteer-extra stealth; all pagination pages are merged."
  );
  if (process.env.ECI_PROXY_URL || process.env.HTTPS_PROXY) {
    console.log("Proxy: ECI_PROXY_URL / HTTPS_PROXY is set (used by got-scraping & Chrome).");
  }
  if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) {
    console.log("Party images: Google Custom Search JSON API enabled (POST /api/party-symbols).");
  }
});
