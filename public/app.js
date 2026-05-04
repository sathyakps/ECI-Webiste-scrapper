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

/** @param {boolean} show */
function setPageLoader(show) {
  const loader = el("page-loader");
  if (!loader) return;
  loader.classList.toggle("hidden", !show);
  loader.setAttribute("aria-busy", show ? "true" : "false");
}

let allRows = [];
let sortKey = "constituency";
let sortDir = "asc";

function countMap(items) {
  const m = new Map();
  for (const x of items) {
    if (!x) continue;
    m.set(x, (m.get(x) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
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
      td.textContent = row[c.key] ?? "";
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
    lt.textContent = "Leading party in this band";
    card.appendChild(lt);

    const partyCounts = countMap(bucket.map((r) => r.leadingParty).filter(Boolean));
    const top = partyCounts.slice(0, 10);
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
      const dot = document.createElement("span");
      dot.className = "margin-leader-row__dot";
      dot.style.background = partyColorHsl(pname, 75, 55);
      const nm = document.createElement("span");
      nm.className = "margin-leader-row__name";
      nm.textContent = pname;
      nm.title = pname;
      const num = document.createElement("span");
      num.className = "margin-leader-row__n";
      num.textContent = String(cnt);
      row.appendChild(dot);
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
  const top = sortedPartyTuples.slice(0, 12);
  const maxS = maxSeats > 0 ? maxSeats : 1;

  for (const [name, n] of top) {
    const card = document.createElement("article");
    card.className = "party-seat-card";
    card.style.setProperty("--party-accent", partyColorHsl(name, 62, 52));

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

  el("stat-total").textContent = String(rows.length);
  el("stat-nailbiters").textContent = String(marginUnder(rows, 1000).length);
  const parties = countMap(rows.map((r) => r.leadingParty));
  const statuses = countMap(rows.map((r) => r.status));
  el("stat-parties").textContent = String(parties.length);
  el("stat-status").textContent = String(statuses.length);

  renderMarginCards(rows);

  const maxP = parties[0]?.[1] || 1;
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
  allRows = data.rows || [];
  if (!allRows.length) {
    showError("No rows parsed. The page layout may have changed.");
    return false;
  }
  renderDashboard(data.meta, allRows);
  renderHeaders();
  renderTable();
  el("main").classList.remove("hidden");
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

async function loadData() {
  hideError();
  el("main").classList.add("hidden");
  el("dash").classList.add("hidden");
  setPageLoader(true);

  const url = DEFAULT_URL;
  try {
    const res = await fetch(
      `/api/results?${new URLSearchParams({ url })}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (!data.ok) {
      if (isAccessDeniedPayload(data)) {
        showBlockedRecovery(data);
      } else {
        const parts = [data.error, data.hint].filter(Boolean);
        showError(parts.join(" — "));
      }
      return;
    }
    if (applySuccessfulPayload(data)) {
      const pages =
        typeof data.pagesFetched === "number" && data.pagesFetched > 1
          ? ` · ${data.pagesFetched} pages merged`
          : "";
      el("fetched-at").textContent = `Last fetched: ${new Date(
        data.fetchedAt
      ).toLocaleString()}${pages}${viaLabel(data.fetchVia)}`;
    }
  } catch (e) {
    showError(e.message || "Network error talking to this app’s server.");
  } finally {
    setPageLoader(false);
  }
}

el("search").addEventListener("input", () => renderTable());

loadData();
