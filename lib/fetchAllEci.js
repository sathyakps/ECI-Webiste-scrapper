const { fetchEciHtml } = require("./fetchEci");
const { parseEciResultsHtml, pickNewerEciSiteUpdate } = require("./parseEci");
const { getResultPageUrlsFromPagination } = require("./pagination");

function normalizePageUrl(u) {
  try {
    const x = new URL(u);
    return x.href.replace(/\/$/, "").split("?")[0];
  } catch {
    return String(u || "");
  }
}

function dedupeRows(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = `${String(r.constNo).trim()}::${String(r.constituency).trim()}`.toLowerCase();
    if (!m.has(k)) m.set(k, r);
  }
  return [...m.values()];
}

/**
 * @param {string} initialUrl
 * @param {{ delayMs?: number }} [opts]
 * @returns {Promise<{ meta: object, rows: object[], pagesFetched: number, pageUrls: string[], fetchVia: string }>}
 */
function pageDelayMs(opts) {
  const fromEnv = Number(process.env.ECI_PAGE_DELAY_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  return opts.delayMs ?? 350;
}

async function fetchMergedEciResults(initialUrl, opts = {}) {
  const delayMs = pageDelayMs(opts);
  const first = await fetchEciHtml(initialUrl);
  const pageUrls = getResultPageUrlsFromPagination(first.html, initialUrl);

  const allRows = [];
  let meta = null;
  const vias = new Set();

  for (let i = 0; i < pageUrls.length; i++) {
    const pageUrl = pageUrls[i];
    const { html, via } =
      pageUrl === initialUrl ? first : await fetchEciHtml(pageUrl);
    vias.add(via);

    const parsed = parseEciResultsHtml(html);
    if (!meta) {
      meta = parsed.meta;
    } else if (parsed.meta && parsed.meta.eciSiteUpdatedRaw) {
      meta.eciSiteUpdatedRaw = pickNewerEciSiteUpdate(
        meta.eciSiteUpdatedRaw || "",
        parsed.meta.eciSiteUpdatedRaw
      );
    }
    allRows.push(...parsed.rows);

    if (i < pageUrls.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const rows = dedupeRows(allRows);
  const fetchVia =
    pageUrls.length > 1
      ? `merged:${[...vias].sort().join("+")}`
      : first.via;

  return {
    meta,
    rows,
    pagesFetched: pageUrls.length,
    pageUrls,
    fetchVia,
  };
}

/**
 * When HTML was pasted, merge other pagination URLs by fetching them from ECI.
 * @param {string} initialHtml
 * @param {string} referencePageUrl URL of the pasted page (resolves relative pagination links).
 * @param {{ delayMs?: number }} [opts]
 */
async function fetchMergedFromPastedHtml(initialHtml, referencePageUrl, opts = {}) {
  const delayMs = pageDelayMs(opts);
  const pageUrls = getResultPageUrlsFromPagination(
    initialHtml,
    referencePageUrl
  );
  const refNorm = normalizePageUrl(referencePageUrl);

  const allRows = [];
  let meta = null;
  const vias = new Set();

  for (let i = 0; i < pageUrls.length; i++) {
    const pageUrl = pageUrls[i];
    let html;
    let via;
    if (normalizePageUrl(pageUrl) === refNorm) {
      html = initialHtml;
      via = "paste";
    } else {
      const r = await fetchEciHtml(pageUrl);
      html = r.html;
      via = r.via;
    }
    vias.add(via);
    const parsed = parseEciResultsHtml(html);
    if (!meta) {
      meta = parsed.meta;
    } else if (parsed.meta && parsed.meta.eciSiteUpdatedRaw) {
      meta.eciSiteUpdatedRaw = pickNewerEciSiteUpdate(
        meta.eciSiteUpdatedRaw || "",
        parsed.meta.eciSiteUpdatedRaw
      );
    }
    allRows.push(...parsed.rows);

    if (i < pageUrls.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const rows = dedupeRows(allRows);
  const fetchVia =
    pageUrls.length > 1
      ? `paste+merged:${[...vias].sort().join("+")}`
      : "paste";

  return {
    meta,
    rows,
    pagesFetched: pageUrls.length,
    pageUrls,
    fetchVia,
  };
}

module.exports = {
  fetchMergedEciResults,
  fetchMergedFromPastedHtml,
  dedupeRows,
};
