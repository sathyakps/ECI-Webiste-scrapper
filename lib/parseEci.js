const cheerio = require("cheerio");

/**
 * Best-effort parse of ECI "as on" style timestamps (DD/MM/YYYY[,] HH:mm[:ss] IST).
 * @param {string} raw
 * @returns {number} epoch ms, or 0 if not parseable
 */
function eciSiteUpdateTimeMs(raw) {
  if (!raw || typeof raw !== "string") return 0;
  const s = raw.trim();
  const m = s.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4}|\d{2})(?:\s*[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!m) return 0;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
  const hh = m[4] != null ? Number(m[4]) : 0;
  const mi = m[5] != null ? Number(m[5]) : 0;
  const ss = m[6] != null ? Number(m[6]) : 0;
  if (![d, mo, y, hh, mi, ss].every((n) => Number.isFinite(n))) return 0;
  const t = Date.UTC(y, mo - 1, d, hh, mi, ss);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Pick the newer / more complete ECI "last updated on site" caption between two parses.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function pickNewerEciSiteUpdate(a, b) {
  const as = String(a || "").trim();
  const bs = String(b || "").trim();
  if (!bs) return as;
  if (!as) return bs;
  const ta = eciSiteUpdateTimeMs(as);
  const tb = eciSiteUpdateTimeMs(bs);
  if (tb > ta) return bs;
  if (ta > tb) return as;
  return bs.length > as.length ? bs : as;
}

/**
 * Extract when ECI says the page data was last updated (wording varies by election).
 * @param {string} html
 * @returns {string}
 */
function extractEciSiteUpdatedRaw(html) {
  if (!html || html.length < 40) return "";
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  const $ = cheerio.load(stripped);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  const y = String.raw`\d{4}|\d{2}`;
  const patterns = [
    new RegExp(
      String.raw`\bas\s+on\s*[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-](?:${y})(?:\s*,\s*|\s+)\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:IST|ist|hrs?))?)`,
      "i"
    ),
    new RegExp(String.raw`\bas\s+on\s*[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-](?:${y}))`, "i"),
    /\bData\s+as\s+on\s*[:\s]+([^.|]{4,80})/i,
    /\bLast\s+updated\s*[:\s]+([^.|]{4,80})/i,
    /\bUpdated\s+on\s*[:\s]+([^.|]{4,80})/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\s*,\s*\d{1,2}:\d{2}(?::\d{2})?\s*IST)/i,
  ];

  for (const re of patterns) {
    const m = bodyText.match(re);
    if (m && m[1]) {
      const out = String(m[1])
        .trim()
        .replace(/\s+/g, " ")
        .replace(/^[:\s.,-]+/, "")
        .slice(0, 120);
      if (out.length >= 4) return out;
    }
  }

  const dt =
    $("[data-updated-at]").first().attr("data-updated-at") ||
    $("[data-as-on]").first().attr("data-as-on");
  if (dt && String(dt).trim()) return String(dt).trim().slice(0, 120);

  return "";
}

function cleanCellText(raw) {
  const cut = String(raw).split(/Party Wise State Trends/i)[0] ?? raw;
  return cut.replace(/\s+/g, " ").replace(/\s*i\s*$/i, "").trim();
}

function parseMarginNum(margin) {
  const n = Number(String(margin).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function rowFromCells(cells) {
  if (cells.length < 9) return null;
  const margin = cells[6] ?? "";
  return {
    constituency: cells[0] ?? "",
    constNo: cells[1] ?? "",
    leadingCandidate: cells[2] ?? "",
    leadingParty: cells[3] ?? "",
    trailingCandidate: cells[4] ?? "",
    trailingParty: cells[5] ?? "",
    margin,
    marginNum: parseMarginNum(margin),
    round: cells[7] ?? "",
    status: cells[8] ?? "",
  };
}

/**
 * @param {string} html
 * @returns {{ meta: { title: string, state: string, summaryLine: string, eciSiteUpdatedRaw: string }, rows: object[] }}
 */
function parseEciResultsHtml(html) {
  const $ = cheerio.load(html);

  const title =
    $(".page-title h1 div").first().text().trim() ||
    $("title").first().text().trim() ||
    "ECI Results";

  const state = $(".page-title h2 span").first().text().trim() || "";

  const eciSiteUpdatedRaw = extractEciSiteUpdatedRaw(html);

  const table =
    $("table.table.table-striped.table-bordered").first().length > 0
      ? $("table.table.table-striped.table-bordered").first()
      : $("table.table-bordered").first();

  let summaryLine = "";
  const firstTh = table.find("thead th[colspan]").first();
  if (firstTh.length) summaryLine = firstTh.text().trim();

  const rows = [];
  if (!table.length) {
    return { meta: { title, state, summaryLine, eciSiteUpdatedRaw }, rows };
  }

  table.find("tbody tr").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 9) return;

    const cells = [];
    tds.each((idx, td) => {
      const el = $(td);
      if (idx === 3 || idx === 5) {
        const partyTd = el.find('td[align="left"]').first();
        const text =
          partyTd.length > 0 ? partyTd.text() : el.text();
        cells.push(cleanCellText(text));
      } else {
        cells.push(cleanCellText(el.text()));
      }
    });

    const row = rowFromCells(cells);
    if (row) rows.push(row);
  });

  return { meta: { title, state, summaryLine, eciSiteUpdatedRaw }, rows };
}

module.exports = {
  parseEciResultsHtml,
  pickNewerEciSiteUpdate,
  extractEciSiteUpdatedRaw,
};
