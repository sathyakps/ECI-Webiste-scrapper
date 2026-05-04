/* global fetch */

const DEFAULT_URL =
  "https://results.eci.gov.in/ResultAcGenMay2026/statewiseS228.htm";

const COLS = [
  { key: "constituency", label: "Constituency" },
  { key: "constNo", label: "Const. No." },
  { key: "leadingCandidate", label: "Leading Candidate" },
  { key: "leadingParty", label: "Leading Party" },
  { key: "trailingCandidate", label: "Trailing Candidate" },
  { key: "trailingParty", label: "Trailing Party" },
  { key: "margin", label: "Margin" },
  { key: "round", label: "Round" },
  { key: "status", label: "Status" },
];

const el = (id) => document.getElementById(id);

/** @type {object | null} */
let electionConfig = null;
/** @type {{ key: string, label: string, parties: string[], urls: string[] }[]} */
let blocOrder = [];
let activeEciUrls = [DEFAULT_URL];

function normalizePartyName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Party name (normalized) → { key, label } */
let partyToBloc = new Map();

function buildBlocLookup() {
  blocOrder = [];
  partyToBloc = new Map();
  if (!electionConfig || typeof electionConfig.blocs !== "object") return;

  const entries = Object.entries(electionConfig.blocs).filter(
    ([k]) => !k.startsWith("_")
  );
  if (entries.length === 0) return;
  if (entries.length > 24) {
    console.warn(
      "election-config.json: at most 24 bloc keys; dashboard will ignore blocs."
    );
    return;
  }

  for (const [key, def] of entries) {
    const label =
      def && String(def.label || "").trim() ? String(def.label).trim() : key;
    const parties = Array.isArray(def && def.parties) ? def.parties : [];
    const urls = Array.isArray(def && def.urls) ? def.urls : [];
    blocOrder.push({ key, label, parties, urls });
    for (const p of parties) {
      const nk = normalizePartyName(p);
      if (nk && !partyToBloc.has(nk)) partyToBloc.set(nk, { key, label });
    }
  }
}

function isBlocDashboard() {
  return blocOrder.length >= 1;
}

/**
 * @param {string | undefined} partyRaw
 * @returns {({ key: string, label: string } | null)}
 */
function resolveBlocForParty(partyRaw) {
  if (!isBlocDashboard()) return null;
  const nk = normalizePartyName(partyRaw);
  if (!nk) return null;
  const hit = partyToBloc.get(nk);
  if (hit) return hit;
  const fb =
    electionConfig &&
    typeof electionConfig.fallbackBloc === "string" &&
    electionConfig.fallbackBloc.trim();
  if (fb) {
    const b = blocOrder.find((x) => x.key === fb.trim());
    if (b) return { key: b.key, label: b.label };
  }
  const last = blocOrder[blocOrder.length - 1];
  return last ? { key: last.key, label: last.label } : null;
}

/**
 * Seat counts per bloc label, in config key order (always three tuples when bloc mode).
 * @param {object[]} rows
 * @returns {[string, number][]}
 */
function blocSeatTuplesForRows(rows) {
  const counts = new Map(blocOrder.map((b) => [b.label, 0]));
  for (const r of rows) {
    const b = resolveBlocForParty(r.leadingParty);
    if (b) counts.set(b.label, (counts.get(b.label) || 0) + 1);
  }
  return blocOrder.map((b) => [b.label, counts.get(b.label) || 0]);
}

/**
 * @param {object[]} rows
 * @returns {[string, number][]} sorted by count desc for margin mini-leaderboard
 */
function blocCountsSortedForRows(rows) {
  const tuples = blocSeatTuplesForRows(rows);
  return [...tuples].sort(
    (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))
  );
}

/**
 * First http(s) entry in a bloc’s `urls` — shown as the bloc logo in table & cards.
 * @param {{ urls?: string[] }} blocEntry
 */
function pickBlocImageUrl(blocEntry) {
  if (!blocEntry || !Array.isArray(blocEntry.urls)) return "";
  for (const u of blocEntry.urls) {
    const s = String(u || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return "";
}

function blocImageUrlForParty(partyRaw) {
  if (!isBlocDashboard()) return "";
  const hit = resolveBlocForParty(partyRaw);
  if (!hit) return "";
  const b = blocOrder.find((x) => x.key === hit.key);
  return b ? pickBlocImageUrl(b) : "";
}

/** @returns {{ primary: string, fallback: string }} */
function blocCardImageUrls(blocLabel) {
  const b = blocOrder.find((x) => x.label === blocLabel);
  const staticU = b ? pickBlocImageUrl(b) : "";
  const g = symbolUrlForParty(blocLabel);
  if (staticU && g && staticU !== g) return { primary: staticU, fallback: g };
  return { primary: staticU || g || "", fallback: "" };
}

/** @returns {{ primary: string, fallback: string }} */
function partyCellImageUrls(rawPartyName) {
  const raw = String(rawPartyName || "").trim();
  const staticU = blocImageUrlForParty(raw);
  const g = symbolUrlForParty(raw);
  if (staticU && g && staticU !== g) return { primary: staticU, fallback: g };
  return { primary: staticU || g || "", fallback: "" };
}

/**
 * @param {HTMLImageElement} img
 * @param {string} primary
 * @param {string} fallback
 * @param {(() => void) | undefined} onFinalFail — e.g. show dot or remove brand row
 */
function wirePartyImageWithFallback(img, primary, fallback, onFinalFail) {
  img.src = primary;
  if (!primary) {
    if (onFinalFail) onFinalFail();
    else img.remove();
    return;
  }
  const fail = () => {
    if (onFinalFail) onFinalFail();
    else img.remove();
  };
  if (fallback) {
    img.addEventListener("error", function onImgErr() {
      if (img.getAttribute("data-img-fb") === "1") {
        fail();
        img.removeEventListener("error", onImgErr);
        return;
      }
      img.setAttribute("data-img-fb", "1");
      img.src = fallback;
    });
  } else {
    img.addEventListener("error", fail);
  }
}

function stampRowsWithState(rows, meta) {
  const st = meta && String(meta.state || "").trim() ? String(meta.state).trim() : "";
  return (rows || []).map((r) => ({ ...r, _state: st }));
}

function dedupeRowsByStateConst(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = `${String(r._state || "")
      .trim()
      .toLowerCase()}::${String(r.constNo).trim()}::${String(r.constituency)
      .trim()
      .toLowerCase()}`;
    if (!m.has(k)) m.set(k, r);
  }
  return [...m.values()];
}

function mergeMeta(a, b) {
  const sa = String(a.state || "").trim();
  const sb = String(b.state || "").trim();
  const states = [...new Set([sa, sb].filter(Boolean))];
  return {
    title: String(a.title || b.title || "ECI Results"),
    state: states.join(" · ") || sa || sb || "",
    summaryLine: [a.summaryLine, b.summaryLine].filter(Boolean).join(" · ") || "",
    eciSiteUpdatedRaw: String(b.eciSiteUpdatedRaw || a.eciSiteUpdatedRaw || ""),
  };
}

/**
 * @param {object | null} acc
 * @param {object} data
 */
function mergePayloads(acc, data) {
  const stamped = stampRowsWithState(data.rows || [], data.meta || {});
  if (!acc) {
    return {
      ok: true,
      sourceUrl: data.sourceUrl,
      fetchedAt: data.fetchedAt,
      fetchVia: data.fetchVia,
      pagesFetched: data.pagesFetched,
      meta: data.meta || {},
      rows: stamped,
    };
  }
  return {
    ok: true,
    sourceUrl: [acc.sourceUrl, data.sourceUrl].filter(Boolean).join(" · "),
    fetchedAt: data.fetchedAt || acc.fetchedAt,
    fetchVia: `multi:${acc.fetchVia || ""}+${data.fetchVia || ""}`,
    pagesFetched: (acc.pagesFetched || 0) + (data.pagesFetched || 0),
    meta: mergeMeta(acc.meta || {}, data.meta || {}),
    rows: dedupeRowsByStateConst([...(acc.rows || []), ...stamped]),
  };
}

async function loadElectionConfig() {
  electionConfig = null;
  blocOrder = [];
  activeEciUrls = [DEFAULT_URL];
  try {
    const r = await fetch("/election-config.json", { cache: "no-store" });
    if (!r.ok) return;
    electionConfig = await r.json();
  } catch {
    electionConfig = null;
    return;
  }
  if (
    electionConfig &&
    Array.isArray(electionConfig.eciUrls) &&
    electionConfig.eciUrls.length
  ) {
    activeEciUrls = electionConfig.eciUrls
      .map((u) => String(u).trim())
      .filter(Boolean)
      .slice(0, 12);
  } else {
    activeEciUrls = [DEFAULT_URL];
  }
  buildBlocLookup();
}

/** @param {boolean} show */
function setPageLoader(show) {
  const loader = el("page-loader");
  if (!loader) return;
  loader.classList.toggle("hidden", !show);
  loader.setAttribute("aria-busy", show ? "true" : "false");
}

/** True after at least one successful load (enables soft refresh UI). */
let hasShownData = false;

/** @param {boolean} on */
function setSoftRefreshing(on) {
  document.body.classList.toggle("is-refreshing", on);
  const bar = el("refresh-progress");
  const btn = el("refresh");
  if (bar) bar.classList.toggle("hidden", !on);
  if (btn) {
    btn.disabled = on;
    btn.setAttribute("aria-busy", on ? "true" : "false");
  }
}

function triggerDashEnterAnim() {
  const d = el("dash");
  const m = el("main");
  if (!d || d.classList.contains("hidden")) return;
  d.classList.remove("dash--enter");
  if (m && !m.classList.contains("hidden")) {
    m.classList.remove("main--enter");
  }
  void d.offsetWidth;
  if (m) void m.offsetWidth;
  d.classList.add("dash--enter");
  if (m && !m.classList.contains("hidden")) {
    m.classList.add("main--enter");
  }
}

let allRows = [];
let sortKey = "constituency";
let sortDir = "asc";

/** Party display name → image URL from Google Custom Search (server-resolved). */
let partyGoogleImageMap = new Map();

function symbolUrlForParty(name) {
  if (!name) return "";
  const key = String(name).trim();
  return partyGoogleImageMap.get(key) || "";
}

function appendPartyCell(td, partyName) {
  const raw = partyName != null ? String(partyName) : "";
  td.className = "party-cell";
  const wrap = document.createElement("span");
  wrap.className = "party-cell__inner";
  const pack = partyCellImageUrls(raw);
  if (pack.primary) {
    const img = document.createElement("img");
    img.className = "party-cell__img";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    wirePartyImageWithFallback(img, pack.primary, pack.fallback);
    wrap.appendChild(img);
  }
  const span = document.createElement("span");
  span.className = "party-cell__text";
  span.textContent = raw;
  wrap.appendChild(span);
  td.appendChild(wrap);
}

async function fetchGooglePartyImages() {
  const set = new Set();
  if (isBlocDashboard()) {
    for (const b of blocOrder) {
      if (!pickBlocImageUrl(b)) set.add(b.label);
    }
    for (const r of allRows) {
      for (const k of ["leadingParty", "trailingParty"]) {
        const p = r[k] && String(r[k]).trim();
        if (p && !blocImageUrlForParty(p)) set.add(p);
      }
    }
  } else {
    for (const r of allRows) {
      if (r.leadingParty) set.add(String(r.leadingParty).trim());
      if (r.trailingParty) set.add(String(r.trailingParty).trim());
    }
  }
  const parties = [...set].filter(Boolean).slice(0, 40);
  if (!parties.length) return;
  try {
    const res = await fetch("/api/party-symbols", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parties }),
    });
    const data = await res.json();
    if (!data.ok || !data.map) return;
    partyGoogleImageMap = new Map();
    for (const [k, v] of Object.entries(data.map)) {
      if (v && typeof v === "string") partyGoogleImageMap.set(k, v);
    }
    refreshPartyVisuals();
  } catch {
    /* optional enhancement; table still works without images */
  }
}

function refreshPartyVisuals() {
  renderTable();
  const dash = el("dash");
  if (!dash || dash.classList.contains("hidden") || !allRows.length) return;
  renderMarginCards(allRows);
  const parties = isBlocDashboard()
    ? blocCountsSortedForRows(allRows)
    : countMap(allRows.map((r) => r.leadingParty));
  const maxP = Math.max(1, parties[0]?.[1] ?? 0);
  renderPartySeatCards(parties, maxP, allRows.length);
}

function countMap(items) {
  const m = new Map();
  for (const x of items) {
    if (!x) continue;
    m.set(x, (m.get(x) || 0) + 1);
  }
  return [...m.entries()].sort(
    (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))
  );
}

function marginSortValue(row) {
  if (row.marginNum != null && Number.isFinite(row.marginNum)) {
    return row.marginNum;
  }
  const n = parseFloat(String(row.margin).replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Constituencies with numeric margin strictly below `cap`. */
function marginUnder(rows, cap) {
  return rows.filter((r) => {
    const m = marginSortValue(r);
    return Number.isFinite(m) && m >= 0 && m < cap;
  });
}

/** Stable HSL colour from party name (for charts / dots). */
function partyColorHsl(name, sat = 72, light = 58) {
  let h = 205;
  if (name) {
    let x = 0;
    for (let i = 0; i < name.length; i++) {
      x = (x << 5) - x + name.charCodeAt(i);
      x |= 0;
    }
    h = (Math.abs(x) % 280) + 25;
  }
  return `hsl(${h} ${sat}% ${light}%)`;
}

function sortedFiltered() {
  const q = el("search").value.trim().toLowerCase();
  let list = allRows;
  if (q) {
    list = allRows.filter((row) =>
      COLS.some((c) => String(row[c.key]).toLowerCase().includes(q))
    );
  }
  const dir = sortDir === "asc" ? 1 : -1;
  const copy = [...list];
  copy.sort((a, b) => {
    if (sortKey === "margin") {
      const av = marginSortValue(a);
      const bv = marginSortValue(b);
      const an = Number.isFinite(av) ? av : -1;
      const bn = Number.isFinite(bv) ? bv : -1;
      return (an - bn) * dir;
    }
    const av = String(a[sortKey]).toLowerCase();
    const bv = String(b[sortKey]).toLowerCase();
    return av.localeCompare(bv, undefined, { numeric: true }) * dir;
  });
  return copy;
}

function renderTable() {
  const tbody = el("tbody");
  tbody.innerHTML = "";
  const rows = sortedFiltered();
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const c of COLS) {
      const td = document.createElement("td");
      if (c.key === "leadingParty" || c.key === "trailingParty") {
        appendPartyCell(td, row[c.key]);
      } else {
        td.textContent = row[c.key] ?? "";
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  el("row-count").textContent = `Showing ${rows.length} of ${allRows.length} rows`;
}

function renderHeaders() {
  const thead = el("thead");
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  for (const c of COLS) {
    const th = document.createElement("th");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = c.label;
    if (sortKey === c.key) {
      const span = document.createElement("span");
      span.textContent = sortDir === "asc" ? " ▲" : " ▼";
      btn.appendChild(span);
    }
    btn.addEventListener("click", () => {
      if (sortKey === c.key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = c.key;
        sortDir = "asc";
      }
      renderHeaders();
      renderTable();
    });
    th.appendChild(btn);
    tr.appendChild(th);
  }
  thead.appendChild(tr);
}

function renderMarginCards(rows) {
  const host = el("margin-cards");
  host.replaceChildren();

  const specs = [
    {
      max: 1000,
      cls: "margin-card--1k",
      label: "Under 1,000 votes",
      hint: "Ultra-tight — recount / legal challenge risk",
    },
    {
      max: 2000,
      cls: "margin-card--2k",
      label: "Under 2,000 votes",
      hint: "Still a knife-edge on ground sentiment",
    },
    {
      max: 5000,
      cls: "margin-card--5k",
      label: "Under 5,000 votes",
      hint: "Competitive — swings matter for alliances",
    },
  ];

  for (const spec of specs) {
    const bucket = marginUnder(rows, spec.max);
    const card = document.createElement("article");
    card.className = `margin-card ${spec.cls}`;

    const lab = document.createElement("div");
    lab.className = "margin-card__label";
    lab.textContent = spec.label;
    card.appendChild(lab);

    const val = document.createElement("div");
    val.className = "margin-card__value";
    val.textContent = String(bucket.length);
    card.appendChild(val);

    const hint = document.createElement("div");
    hint.className = "margin-card__hint";
    hint.textContent = spec.hint;
    card.appendChild(hint);

    if (bucket.length === 0) {
      const empty = document.createElement("p");
      empty.className = "margin-card__empty";
      empty.textContent = "No constituencies in this band with a numeric margin.";
      card.appendChild(empty);
      host.appendChild(card);
      continue;
    }

    const lt = document.createElement("div");
    lt.className = "margin-card__leaders-title";
    lt.textContent = isBlocDashboard()
      ? "Leading bloc in this band"
      : "Leading party in this band";
    card.appendChild(lt);

    const partyCounts = isBlocDashboard()
      ? blocCountsSortedForRows(bucket)
      : countMap(bucket.map((r) => r.leadingParty).filter(Boolean));
    const top = isBlocDashboard()
      ? partyCounts.slice(0, blocOrder.length)
      : partyCounts.slice(0, 10);
    const total = top.reduce((s, [, c]) => s + c, 0) || 1;

    const stack = document.createElement("div");
    stack.className = "margin-stack";
    stack.setAttribute("role", "img");
    stack.setAttribute(
      "aria-label",
      `Party mix among ${bucket.length} constituencies under ${spec.max} votes`
    );
    for (const [pname, cnt] of top) {
      const seg = document.createElement("div");
      seg.className = "margin-stack__seg";
      seg.style.width = `${(cnt / total) * 100}%`;
      seg.style.background = partyColorHsl(pname, 78, 52);
      seg.title = `${pname}: ${cnt}`;
      stack.appendChild(seg);
    }
    card.appendChild(stack);

    const rowsWrap = document.createElement("div");
    rowsWrap.className = "margin-leader-rows";
    for (const [pname, cnt] of top.slice(0, 5)) {
      const row = document.createElement("div");
      row.className = "margin-leader-row";
      const sym = document.createElement("span");
      sym.className = "margin-leader-row__sym";
      const pack = isBlocDashboard()
        ? blocCardImageUrls(pname)
        : { primary: symbolUrlForParty(pname), fallback: "" };
      const showDot = () => {
        sym.replaceChildren();
        const dot = document.createElement("span");
        dot.className = "margin-leader-row__dot";
        dot.style.background = partyColorHsl(pname, 75, 55);
        sym.appendChild(dot);
      };
      if (pack.primary) {
        const img = document.createElement("img");
        img.className = "margin-leader-row__img";
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        wirePartyImageWithFallback(img, pack.primary, pack.fallback, showDot);
        sym.appendChild(img);
      } else {
        showDot();
      }
      const nm = document.createElement("span");
      nm.className = "margin-leader-row__name";
      nm.textContent = pname;
      nm.title = pname;
      const num = document.createElement("span");
      num.className = "margin-leader-row__n";
      num.textContent = String(cnt);
      row.appendChild(sym);
      row.appendChild(nm);
      row.appendChild(num);
      rowsWrap.appendChild(row);
    }
    card.appendChild(rowsWrap);

    host.appendChild(card);
  }
}

/** Party seat counts as colourful cards (same pattern as margin deck). */
function renderPartySeatCards(sortedPartyTuples, maxSeats, totalACs) {
  const host = el("party-cards");
  host.replaceChildren();
  const limit = isBlocDashboard() ? blocOrder.length : 12;
  const top = sortedPartyTuples.slice(0, limit);
  const maxS = maxSeats > 0 ? maxSeats : 1;

  for (const [name, n] of top) {
    const card = document.createElement("article");
    card.className = "party-seat-card";
    card.style.setProperty("--party-accent", partyColorHsl(name, 62, 52));

    const pack = isBlocDashboard()
      ? blocCardImageUrls(name)
      : { primary: symbolUrlForParty(name), fallback: "" };
    if (pack.primary) {
      const brand = document.createElement("div");
      brand.className = "party-seat-card__brand";
      const img = document.createElement("img");
      img.className = "party-seat-card__sym";
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      wirePartyImageWithFallback(img, pack.primary, pack.fallback, () =>
        brand.remove()
      );
      brand.appendChild(img);
      card.appendChild(brand);
    }

    const lab = document.createElement("div");
    lab.className = "party-seat-card__label";
    lab.textContent = name;
    card.appendChild(lab);

    const val = document.createElement("div");
    val.className = "party-seat-card__value";
    val.textContent = String(n);
    card.appendChild(val);

    const hint = document.createElement("div");
    hint.className = "party-seat-card__hint";
    const pctAll =
      totalACs > 0 ? ((n / totalACs) * 100).toFixed(1) : "0.0";
    hint.textContent = `${pctAll}% of all ${totalACs} constituencies in view`;
    card.appendChild(hint);

    const meter = document.createElement("div");
    meter.className = "party-seat-meter";
    const fill = document.createElement("div");
    fill.className = "party-seat-meter__fill";
    fill.style.width = `${(n / maxS) * 100}%`;
    const c1 = partyColorHsl(name, 76, 56);
    const c2 = partyColorHsl(name, 70, 66);
    fill.style.background = `linear-gradient(90deg, ${c1}, ${c2})`;
    meter.appendChild(fill);
    card.appendChild(meter);

    const cap = document.createElement("p");
    cap.className = "party-seat-meter__cap";
    const pctLead = maxS > 0 ? ((n / maxS) * 100).toFixed(0) : "0";
    cap.textContent = `${pctLead}% of top party tally (${maxS} seats)`;
    card.appendChild(cap);

    host.appendChild(card);
  }
}

function renderDashboard(meta, rows) {
  el("dash").classList.remove("hidden");
  el("meta-state").textContent = meta.state || "Results";
  el("meta-title").textContent = meta.title || "";
  el("meta-summary").textContent = meta.summaryLine || "";
  el("meta-summary").classList.toggle("hidden", !meta.summaryLine);

  const eciUp = el("meta-eci-updated");
  const eciRaw =
    meta.eciSiteUpdatedRaw && String(meta.eciSiteUpdatedRaw).trim();
  if (eciRaw) {
    eciUp.textContent = `ECI results page shows data as on: ${eciRaw}`;
    eciUp.classList.remove("hidden");
  } else {
    eciUp.textContent = "";
    eciUp.classList.add("hidden");
  }

  el("stat-total").textContent = String(rows.length);
  el("stat-nailbiters").textContent = String(marginUnder(rows, 1000).length);
  const parties = isBlocDashboard()
    ? blocCountsSortedForRows(rows)
    : countMap(rows.map((r) => r.leadingParty));
  const statuses = countMap(rows.map((r) => r.status));
  const capParties = el("stat-parties-caption");
  if (isBlocDashboard()) {
    el("stat-parties").textContent = String(blocOrder.length);
    if (capParties) capParties.textContent = "Electoral blocs";
  } else {
    el("stat-parties").textContent = String(parties.length);
    if (capParties) capParties.textContent = "Leading parties";
  }
  el("stat-status").textContent = String(statuses.length);

  renderMarginCards(rows);

  const maxP = Math.max(1, parties[0]?.[1] ?? 0);
  renderPartySeatCards(parties, maxP, rows.length);

  const chipList = el("status-chips");
  chipList.innerHTML = "";
  const statusColors = [
    "hsl(142 65% 48%)",
    "hsl(199 85% 55%)",
    "hsl(280 70% 62%)",
    "hsl(38 92% 55%)",
    "hsl(340 75% 58%)",
  ];
  let si = 0;
  for (const [s, n] of statuses) {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = s;
    left.style.borderLeft = `3px solid ${statusColors[si % statusColors.length]}`;
    left.style.paddingLeft = "0.45rem";
    const right = document.createElement("strong");
    right.textContent = String(n);
    li.appendChild(left);
    li.appendChild(right);
    chipList.appendChild(li);
    si += 1;
  }
}

function showError(msg) {
  const b = el("error");
  b.replaceChildren(document.createTextNode(msg));
  b.classList.remove("hidden");
}

/** Akamai / ECI blocked the server. */
function showBlockedRecovery(data) {
  const b = el("error");
  b.replaceChildren();

  const strong = document.createElement("strong");
  strong.textContent = "Could not load results from ECI";
  b.appendChild(strong);

  const p = document.createElement("p");
  p.className = "err-sub";
  p.textContent =
    data.hint ||
    "The server could not fetch the results page (access denied or network block). Try again in a few minutes, or run this app from a network that can reach results.eci.gov.in.";
  b.appendChild(p);

  b.classList.remove("hidden");
}

function isAccessDeniedPayload(data) {
  return (
    data &&
    (data.code === "ECI_ACCESS_DENIED" ||
      /access denied page|Access Denied/i.test(String(data.error || "")))
  );
}

function hideError() {
  el("error").classList.add("hidden");
}

/** @returns {boolean} */
function applySuccessfulPayload(data) {
  partyGoogleImageMap = new Map();
  allRows = data.rows || [];
  if (!allRows.length) {
    showError("No rows parsed. The page layout may have changed.");
    return false;
  }
  renderDashboard(data.meta, allRows);
  renderHeaders();
  renderTable();
  el("main").classList.remove("hidden");
  void fetchGooglePartyImages();
  return true;
}

function viaLabel(fetchVia) {
  if (fetchVia && String(fetchVia).startsWith("merged:")) {
    return " · all pages merged (" + String(fetchVia).replace(/^merged:/, "") + ")";
  }
  if (fetchVia && String(fetchVia).startsWith("paste+merged:")) {
    return " · pasted + other pages (" + String(fetchVia).replace(/^paste\+merged:/, "") + ")";
  }
  if (fetchVia === "puppeteer-stealth") return " · via stealth Chrome";
  if (fetchVia === "got-scraping") return " · via TLS/browser fingerprint client";
  if (fetchVia === "playwright") return " · via headless Chrome";
  if (fetchVia === "axios") return " · via HTTP client";
  if (fetchVia === "paste") return " · from pasted HTML";
  return "";
}

/**
 * @param {{ soft?: boolean }} [opts]
 *   soft — keep dashboard/table visible, show header progress (only if `hasShownData`).
 */
async function loadData(opts = {}) {
  const soft = Boolean(opts.soft && hasShownData);
  await loadElectionConfig();
  hideError();
  if (!soft) {
    el("main").classList.add("hidden");
    el("dash").classList.add("hidden");
    setPageLoader(true);
  } else {
    setSoftRefreshing(true);
  }

  const urls =
    activeEciUrls && activeEciUrls.length ? activeEciUrls : [DEFAULT_URL];
  try {
    let merged = null;
    /** @type {object | null} */
    let lastFail = null;
    for (const url of urls) {
      const res = await fetch(
        `/api/results?${new URLSearchParams({ url })}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.ok && data.rows && data.rows.length) {
        merged = mergePayloads(merged, data);
      } else {
        lastFail = data;
      }
    }

    if (!merged || !merged.rows.length) {
      if (lastFail && isAccessDeniedPayload(lastFail)) {
        showBlockedRecovery(lastFail);
      } else if (lastFail && !lastFail.ok) {
        const parts = [lastFail.error, lastFail.hint].filter(Boolean);
        showError(parts.join(" — "));
      } else {
        showError(
          "No constituency rows loaded. Check election-config.json eciUrls and network."
        );
      }
      return;
    }

    if (applySuccessfulPayload(merged)) {
      hasShownData = true;
      triggerDashEnterAnim();
      const pages =
        typeof merged.pagesFetched === "number" && merged.pagesFetched > 1
          ? ` · ${merged.pagesFetched} pages merged`
          : "";
      const multi =
        urls.length > 1 ? ` · ${urls.length} ECI sources merged` : "";
      el("fetched-at").textContent = `Last fetched: ${new Date(
        merged.fetchedAt
      ).toLocaleString()}${pages}${multi}${viaLabel(merged.fetchVia)}`;
      const fl = el("footer-link");
      if (fl && urls[0]) {
        try {
          fl.href = urls[0];
        } catch {
          /* ignore invalid href */
        }
      }
    }
  } catch (e) {
    showError(e.message || "Network error talking to this app’s server.");
  } finally {
    if (!soft) setPageLoader(false);
    else setSoftRefreshing(false);
  }
}

async function refreshVisitCount() {
  const n = el("visit-count");
  if (!n) return;
  try {
    const res = await fetch("/api/stats", { cache: "no-store" });
    const data = await res.json();
    if (data.ok && Number.isFinite(data.visitCount)) {
      n.textContent = Number(data.visitCount).toLocaleString();
    } else {
      n.textContent = "—";
    }
  } catch {
    n.textContent = "—";
  }
}

el("search").addEventListener("input", () => renderTable());
el("refresh").addEventListener("click", () => loadData({ soft: true }));

(async function init() {
  void refreshVisitCount();
  await loadData();
})();
