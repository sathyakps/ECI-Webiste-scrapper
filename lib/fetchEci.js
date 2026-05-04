const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { addExtra } = require("puppeteer-extra");
const vanillaPuppeteer = require("puppeteer-core");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const puppeteer = addExtra(vanillaPuppeteer);
puppeteer.use(StealthPlugin());

/** @type {Map<string, string>} */
function applySetCookie(map, res) {
  const raw = res.headers["set-cookie"];
  if (!raw) return;
  const lines = Array.isArray(raw) ? raw : [raw];
  for (const line of lines) {
    const pair = line.split(";")[0].trim();
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) map.set(name, value);
  }
}

function cookieHeader(map) {
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function chromeLikeHeaders(overrides = {}) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua":
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    ...overrides,
  };
}

function proxyUrl() {
  return (
    process.env.ECI_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    ""
  ).trim();
}

function isBlockedHtml(html) {
  if (typeof html !== "string" || html.length < 80) return true;
  if (/<title>\s*Access Denied\s*<\/title>/i.test(html.slice(0, 6000))) {
    return true;
  }
  if (/reference\s*#\s*18\./i.test(html) && /edgesuite/i.test(html)) {
    return true;
  }
  return false;
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchEciHtmlWithAxios(url) {
  const u = new URL(url);
  const origin = u.origin;
  const pathStr = u.pathname;
  const lastSlash = pathStr.lastIndexOf("/");
  const dir = lastSlash >= 0 ? pathStr.slice(0, lastSlash + 1) : "/";
  const indexUrl = `${origin}${dir}index.htm`;

  /** @type {Map<string, string>} */
  const jar = new Map();

  const client = axios.create({
    timeout: 60000,
    maxRedirects: 7,
    responseType: "text",
    validateStatus: () => true,
    decompress: true,
    proxy: false,
  });

  async function get(href, headers) {
    const h = { ...headers };
    const c = cookieHeader(jar);
    if (c) h.Cookie = c;
    return client.get(href, { headers: h });
  }

  const steps = [
    {
      href: `${origin}/`,
      headers: chromeLikeHeaders({
        Referer: origin + "/",
        "Sec-Fetch-Site": "none",
      }),
    },
    {
      href: indexUrl,
      headers: chromeLikeHeaders({
        Referer: `${origin}/`,
        "Sec-Fetch-Site": "same-origin",
      }),
    },
    {
      href: url,
      headers: chromeLikeHeaders({
        Referer: indexUrl,
        "Sec-Fetch-Site": "same-origin",
      }),
    },
  ];

  let lastRes = null;
  for (const step of steps) {
    lastRes = await get(step.href, step.headers);
    applySetCookie(jar, lastRes);
  }

  if (!lastRes) {
    throw new Error("No response from ECI");
  }

  if (lastRes.status < 200 || lastRes.status >= 300) {
    const err = new Error(`ECI returned HTTP ${lastRes.status}`);
    err.status = lastRes.status;
    err.bodyPreview =
      typeof lastRes.data === "string" ? lastRes.data.slice(0, 240) : "";
    throw err;
  }

  if (typeof lastRes.data !== "string") {
    throw new Error("Unexpected response type from ECI");
  }

  return lastRes.data;
}

/**
 * Browser-like TLS / HTTP2 fingerprint (got-scraping v3).
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchWithGotScraping(url) {
  const { gotScraping } = await import("got-scraping");
  const { CookieJar } = await import("tough-cookie");

  const u = new URL(url);
  const origin = u.origin;
  const pathStr = u.pathname;
  const lastSlash = pathStr.lastIndexOf("/");
  const dir = lastSlash >= 0 ? pathStr.slice(0, lastSlash + 1) : "/";
  const indexUrl = `${origin}${dir}index.htm`;

  const jar = new CookieJar();
  const px = proxyUrl();

  const steps = [
    {
      href: `${origin}/`,
      headers: chromeLikeHeaders({
        Referer: origin + "/",
        "Sec-Fetch-Site": "none",
      }),
    },
    {
      href: indexUrl,
      headers: chromeLikeHeaders({
        Referer: `${origin}/`,
        "Sec-Fetch-Site": "same-origin",
      }),
    },
    {
      href: url,
      headers: chromeLikeHeaders({
        Referer: indexUrl,
        "Sec-Fetch-Site": "same-origin",
      }),
    },
  ];

  let lastBody = "";
  let lastStatus = 0;
  for (const step of steps) {
    const res = await gotScraping.get(step.href, {
      cookieJar: jar,
      timeout: { request: 65000 },
      followRedirect: true,
      retry: { limit: 0 },
      throwHttpErrors: false,
      headers: step.headers,
      ...(px ? { proxyUrl: px } : {}),
    });
    lastStatus = res.statusCode;
    lastBody = typeof res.body === "string" ? res.body : String(res.body || "");
    if (lastStatus < 200 || lastStatus >= 300) {
      const err = new Error(`ECI returned HTTP ${lastStatus} (got-scraping)`);
      err.status = lastStatus;
      throw err;
    }
  }

  return lastBody;
}

function resolveBrowserExecutable() {
  const envPath =
    (process.env.ECI_REAL_BROWSER_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium"
    );
  }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* */
    }
  }

  try {
    const { chromium } = require("playwright");
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* */
  }

  return null;
}

function profileDir() {
  return path.join(__dirname, "..", ".eci-browser-profile");
}

/** Serialize puppeteer launches (same Chrome profile). */
const profileGate = (() => {
  let chain = Promise.resolve();
  return (fn) => {
    const out = chain.then(() => fn());
    chain = out.catch(() => {});
    return out;
  };
})();

/**
 * Headless Chrome with stealth + persistent profile (Akamai cookies).
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchWithPuppeteerStealth(url) {
  return profileGate(async () => {
    const executablePath = resolveBrowserExecutable();
    if (!executablePath) {
      const err = new Error(
        "No Chrome/Chromium found. Install Google Chrome, or run: npm run install-browser"
      );
      err.status = 403;
      throw err;
    }

    const userDataDir = profileDir();
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch {
      /* */
    }

    const px = proxyUrl();
    const launchArgs = [
      "--disable-blink-features=AutomationControlled",
      "--window-size=1440,900",
      "--lang=en-US",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ];
    if (px) {
      try {
        const u = new URL(px.startsWith("http") ? px : `http://${px}`);
        launchArgs.push(`--proxy-server=${u.protocol}//${u.host}`);
      } catch {
        /* */
      }
    }

    const browser = await puppeteer.launch({
      headless: "new",
      executablePath,
      userDataDir,
      args: launchArgs,
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });

      const u = new URL(url);
      const pathStr = u.pathname;
      const lastSlash = pathStr.lastIndexOf("/");
      const dir = lastSlash >= 0 ? pathStr.slice(0, lastSlash + 1) : "/";
      const indexUrl = `${u.origin}${dir}index.htm`;

      const step = async (href, referer) => {
        if (referer) {
          await page.setExtraHTTPHeaders({ Referer: referer });
        } else {
          await page.setExtraHTTPHeaders({});
        }
        await page.goto(href, {
          waitUntil: "domcontentloaded",
          timeout: 120000,
        });
        await new Promise((r) => setTimeout(r, 900));
      };

      await step(`${u.origin}/`, "");
      await step(indexUrl, `${u.origin}/`);
      await step(url, indexUrl);

      await new Promise((r) => setTimeout(r, 1500));
      return await page.content();
    } finally {
      await browser.close();
    }
  });
}

/**
 * Axios → got-scraping (TLS mimic) → puppeteer-extra stealth + real Chrome when available.
 * @param {string} url
 * @returns {Promise<{ html: string, via: string }>}
 */
async function fetchEciHtml(url) {
  if (process.env.ECI_USE_AXIOS_ONLY === "1") {
    const html = await fetchEciHtmlWithAxios(url);
    return { html, via: "axios" };
  }

  try {
    const html = await fetchEciHtmlWithAxios(url);
    if (!isBlockedHtml(html)) return { html, via: "axios" };
  } catch (e) {
    if (e.status !== 403) throw e;
  }

  if (process.env.ECI_SKIP_GOT_SCRAPING !== "1") {
    try {
      const html = await fetchWithGotScraping(url);
      if (!isBlockedHtml(html)) return { html, via: "got-scraping" };
    } catch {
      /* try stealth */
    }
  }

  if (process.env.ECI_SKIP_PUPPETEER === "1") {
    const err = new Error(
      "ECI blocked automated clients (Akamai). Stealth browser is disabled (ECI_SKIP_PUPPETEER=1)."
    );
    err.status = 403;
    err.code = "ECI_ACCESS_DENIED";
    throw err;
  }

  const html = await fetchWithPuppeteerStealth(url);
  if (!isBlockedHtml(html)) {
    return { html, via: "puppeteer-stealth" };
  }

  const err = new Error(
    "ECI blocked this fetch: the response was an Access Denied page (Akamai)."
  );
  err.status = 403;
  err.code = "ECI_ACCESS_DENIED";
  throw err;
}

module.exports = {
  fetchEciHtml,
  fetchEciHtmlWithAxios,
  fetchWithGotScraping,
  fetchWithPuppeteerStealth,
  isBlockedHtml,
};
