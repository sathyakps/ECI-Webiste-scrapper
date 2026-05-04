const cheerio = require("cheerio");

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
 * @returns {{ meta: { title: string, state: string, summaryLine: string }, rows: object[] }}
 */
function parseEciResultsHtml(html) {
  const $ = cheerio.load(html);

  const title =
    $(".page-title h1 div").first().text().trim() ||
    $("title").first().text().trim() ||
    "ECI Results";

  const state = $(".page-title h2 span").first().text().trim() || "";

  const table =
    $("table.table.table-striped.table-bordered").first().length > 0
      ? $("table.table.table-striped.table-bordered").first()
      : $("table.table-bordered").first();

  let summaryLine = "";
  const firstTh = table.find("thead th[colspan]").first();
  if (firstTh.length) summaryLine = firstTh.text().trim();

  const rows = [];
  if (!table.length) {
    return { meta: { title, state, summaryLine }, rows };
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

  return { meta: { title, state, summaryLine }, rows };
}

module.exports = { parseEciResultsHtml };
