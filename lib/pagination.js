const cheerio = require("cheerio");

/**
 * ECI statewise pages list siblings in <ul class="pagination"> as statewiseS221.htm … S2212.htm.
 * @param {string} html
 * @param {string} referencePageUrl Absolute URL of the page `html` came from (for resolving relative hrefs).
 * @returns {string[]} Sorted unique absolute URLs, one per numbered results page.
 */
function getResultPageUrlsFromPagination(html, referencePageUrl) {
  const $ = cheerio.load(html);
  let base;
  try {
    base = new URL(referencePageUrl);
  } catch {
    return [referencePageUrl];
  }

  const items = [];

  $("ul.pagination a.page-link[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !/statewise/i.test(href)) return;
    const label = parseInt($(el).text().trim(), 10);
    if (!Number.isFinite(label) || label < 1) return;
    try {
      const abs = new URL(href, base).href;
      items.push({ label, abs });
    } catch {
      /* */
    }
  });

  if (items.length === 0) {
    return [base.href];
  }

  items.sort((a, b) => a.label - b.label);

  const seen = new Set();
  const ordered = [];
  for (const { abs } of items) {
    if (!seen.has(abs)) {
      seen.add(abs);
      ordered.push(abs);
    }
  }

  return ordered;
}

module.exports = { getResultPageUrlsFromPagination };
