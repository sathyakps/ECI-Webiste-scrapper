const fs = require("fs");
const path = require("path");

const COUNT_FILE = path.join(__dirname, "..", ".visit-count.json");

function readTotalSync() {
  try {
    const raw = fs.readFileSync(COUNT_FILE, "utf8");
    const o = JSON.parse(raw);
    const n = Math.floor(Number(o.total));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeTotalSync(n) {
  fs.mkdirSync(path.dirname(COUNT_FILE), { recursive: true });
  fs.writeFileSync(COUNT_FILE, JSON.stringify({ total: n }, null, 0), "utf8");
}

let cachedTotal = readTotalSync();

/**
 * Bump count for a full HTML page view (home). Safe to call once per GET /.
 * @returns {number} new total
 */
function recordHomePageVisit() {
  const next = readTotalSync() + 1;
  writeTotalSync(next);
  cachedTotal = next;
  return next;
}

function getVisitCount() {
  return cachedTotal;
}

/** Sync cache from disk (e.g. after external edit). */
function refreshCacheFromDisk() {
  cachedTotal = readTotalSync();
  return cachedTotal;
}

module.exports = {
  recordHomePageVisit,
  getVisitCount,
  refreshCacheFromDisk,
};
