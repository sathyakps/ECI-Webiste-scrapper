const axios = require("axios");

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** @type {Map<string, { url: string | null, at: number }>} */
const cache = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} raw
 * @returns {string}
 */
function sanitizePartyLabel(raw) {
  return String(raw || "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/**
 * One image URL from Google Custom Search (image type).
 * @param {string} partyName
 * @param {string} apiKey
 * @param {string} cx
 * @returns {Promise<string | null>}
 */
async function fetchGoogleImageUrlOnce(partyName, apiKey, cx) {
  const label = sanitizePartyLabel(partyName);
  if (label.length < 2) return null;

  const q = `${label} political party election symbol India`;
  const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
    params: {
      key: apiKey,
      cx,
      q,
      searchType: "image",
      num: 1,
      safe: "active",
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (res.status !== 200) return null;
  const link = res.data && res.data.items && res.data.items[0] && res.data.items[0].link;
  if (typeof link !== "string" || !/^https?:\/\//i.test(link)) return null;
  return link.slice(0, 2048);
}

/**
 * @param {string} partyName display string (must match row keys client-side)
 * @param {string} apiKey
 * @param {string} cx
 * @returns {Promise<string | null>}
 */
async function fetchCached(partyName, apiKey, cx) {
  const ck = sanitizePartyLabel(partyName).toLowerCase();
  if (ck.length < 2) return null;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.url;

  let url = null;
  try {
    url = await fetchGoogleImageUrlOnce(partyName, apiKey, cx);
  } catch {
    url = null;
  }
  cache.set(ck, { url, at: Date.now() });
  return url;
}

/**
 * Resolve image URLs for a bounded list of party names (sequential to respect quotas).
 * @param {string[]} parties
 * @returns {Promise<{ map: Record<string, string | null>, configured: boolean }>}
 */
async function resolvePartySymbolsBatch(parties) {
  const apiKey = (process.env.GOOGLE_CSE_API_KEY || "").trim();
  const cx = (process.env.GOOGLE_CSE_CX || "").trim();
  const configured = Boolean(apiKey && cx);

  /** @type {Record<string, string | null>} */
  const map = {};

  const seen = new Set();
  const uniq = [];
  for (const p of parties) {
    const t = sanitizePartyLabel(p);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
    if (uniq.length >= 40) break;
  }

  if (!configured) {
    for (const t of uniq) map[t] = null;
    return { map, configured: false };
  }

  for (const name of uniq) {
    map[name] = await fetchCached(name, apiKey, cx);
    await sleep(100);
  }

  return { map, configured: true };
}

module.exports = {
  resolvePartySymbolsBatch,
  sanitizePartyLabel,
};
