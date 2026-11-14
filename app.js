/* Filament Labels: search the bundled database, edit, render the M02 sticker, save the PNG. */
/* global LabelRender */
"use strict";
const $ = (s) => document.querySelector(s);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
let DB = null, items = [], current = null;

// ---------- data
async function loadData() {
  const [data, urls] = await Promise.all([
    fetch("data.json").then((r) => r.json()),
    fetch("brand-urls.json").then((r) => r.json()).catch(() => ({})),
  ]);
  DB = data; DB.brandUrls = urls;
  const F = data.filaments.map((f) => ({
    brand: data.brands[f[0]][0], website: data.brands[f[0]][1], line: f[1], material: f[2],
    noz: [f[3], f[4]], bed: [f[5], f[6]], cham: [f[7], f[8]], dry: [f[9], f[10]],
    enc: f[11], ds: f[12], src: f[13],
  }));
  items = data.variants.map((v) => {
    const f = F[v[0]];
    const hay = `${f.brand} ${f.line} ${f.material} ${v[1]}`.toLowerCase();
    return { f, color: v[1], hex: v[2], td: v[3], ab: !!v[4], url: v[5], hay, hayN: norm(hay) };
  });
  $("#ver").textContent = `· db ${data.version}`;
  $("#status").textContent = `${items.length.toLocaleString()} colours from ${data.brands.length} brands. Type to search.`;
}

function search(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  for (const it of items) {
    let score = 0, ok = true;
    for (const t of toks) {
      const i = it.hay.indexOf(t);
      if (i >= 0) score += i === 0 || it.hay[i - 1] === " " ? 2 : 1;
      else if (it.hayN.includes(norm(t))) score += 1;      // "pla+" vs "pla plus" style misses still hit
      else { ok = false; break; }
    }
    if (ok) out.push([score, it]);
  }
  out.sort((a, b) => b[0] - a[0] || a[1].hay.localeCompare(b[1].hay));
  return out.slice(0, 60).map((x) => x[1]);
}

function showResults(list) {
  const ul = $("#results"); ul.innerHTML = "";
  for (const it of list) {
    const li = document.createElement("li");
    const sw = document.createElement("span"); sw.className = "sw"; sw.style.background = it.hex || "transparent";
    const t = document.createElement("div");
    t.innerHTML = `<div class="r1"></div><div class="r2"></div>`;
    t.children[0].textContent = `${it.f.brand} · ${lineOf(it.f)}`;
    t.children[1].textContent = `${it.color}${it.f.noz[0] ? ` · ${range(it.f.noz)}` : ""}`;
    li.append(sw, t); li.onclick = () => open(it); ul.appendChild(li);
  }
  const q = $("#q").value.trim();
  $("#status").textContent = q ? (list.length ? `${list.length}${list.length === 60 ? "+" : ""} matches` : "No matches. Try fewer words.") : $("#status").textContent;
}

// ---------- label values
function lineOf(f) {
  let l = f.line.replace(new RegExp("^" + f.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), "").trim() || f.material;
  if (!norm(l).includes(norm(f.material))) l = `${l} ${f.material}`;
  return l;
}
const range = ([lo, hi], u = "°C") =>
  lo != null && hi != null && lo !== hi ? `${lo}–${hi}${u}` : (lo ?? hi) != null ? `${lo ?? hi}${u}` : "";
function dryStr([t, h]) { return t ? `${t}°C${h ? ` × ${h}h` : ""}` : ""; }

function defaultsFor(f) {
  const m = f.material.toUpperCase();
  return DB.defaults[m] || DB.defaults[m.replace(/[-+ ].*$/, "")] || {};
}

function qrCandidates(it) {
  const f = it.f, c = [];
  const add = (label, u) => { if (u && !c.some((x) => x.u === u)) c.push({ label, u }); };
  add("Product page", it.url);
  add("Brand settings page", DB.brandUrls[f.brand]);
  if (f.ds && f.ds.length <= 100) add("Data sheet", f.ds);
  add("Brand website", f.website);
  if (f.ds && f.ds.length > 100) add("Data sheet (long → big QR)", f.ds);
  return c;
}

function open(it) {
  current = it;
  const f = it.f, d = defaultsFor(f), form = $("#f");
  const typ = new Set();
  const val = (own, def, fmt, key) => {
    if (own) return own;
    const v = def ? fmt(def) : "";
    if (v) { typ.add(key); return `${v} typ`; }
    return "";
  };
  const enc = f.enc || (d.enc ? d.enc[0] : "");
  const needsEnc = enc === "required" || enc === "recommended";
  const vals = {
    brand: f.brand, line: lineOf(f), color: it.color, hex: it.hex,
    nozzle: val(range(f.noz), d.noz, range, "nozzle"),
    bed: val(range(f.bed), d.bed, range, "bed"),
    chamber: val(range(f.cham), needsEnc ? d.cham : null, range, "chamber"),
    dry: val(dryStr(f.dry), d.dry, dryStr, "dry"),
    flow: "", td: it.td != null ? String(it.td) : "", qr: "",
  };
  for (const [k, v] of Object.entries(vals)) {
    const el = form.elements[k]; el.value = v; el.classList.toggle("typ", typ.has(k));
  }
  form.elements.fl_hard.checked = it.ab;
  form.elements.fl_enc.checked = needsEnc;
  form.elements.fl_hygro.checked = false;
  form.elements.opened.checked = true;
  const sel = form.elements.qrpick; sel.innerHTML = "";
  for (const c of qrCandidates(it)) sel.add(new Option(`${c.label} (${c.u.length} chars)`, c.u));
  sel.add(new Option("None (no QR)", ""));
  form.elements.qr.value = sel.options[0].value;
  const srcName = { o: "Open Filament Database", s: "SpoolmanDB", os: "Open Filament Database + SpoolmanDB" }[f.src];
  $("#src").textContent = `Source: ${srcName}. Check values against the box before printing.`;
  $("#results").hidden = true; $("#editor").hidden = false; $("#bar").hidden = false;
  $("#status").hidden = true;
  window.scrollTo(0, 0);
  draw();
}

function spec() {
  const e = $("#f").elements;
  const flags = [];
  if (e.fl_hard.checked) flags.push("HARDENED NOZZLE");
  if (e.fl_enc.checked) flags.push("ENCLOSURE");
  if (e.fl_hygro.checked) flags.push("VERY HYGRO");
  return {
    brand: e.brand.value.trim(), line: e.line.value.trim(), color: e.color.value.trim(),
    hex: e.hex.value.trim(),
    rows: [["Nozzle", e.nozzle.value.trim()], ["Bed Temp", e.bed.value.trim()],
           ["Chamber", e.chamber.value.trim()], ["Dry", e.dry.value.trim()],
           ["Flow Ratio", e.flow.value.trim()], ["TD", e.td.value.trim()]],
    flags, opened: e.opened.checked, qr_url: e.qr.value.trim(),
  };
}

let lastCanvas = null;
function draw() {
  const out = LabelRender.render(spec());
  const c = $("#label"); c.width = out.width; c.height = out.height;
  c.getContext("2d").drawImage(out, 0, 0);
  lastCanvas = out;
  $("#len").textContent = `${(out.height / 8).toFixed(0)} mm long · 48 mm printed width`;
}

function fileName() {
  const s = spec();
  return [s.brand, s.line, s.color].map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean).join("_") + ".png";
}

function blob() { return new Promise((res) => lastCanvas.toBlob(res, "image/png")); }

async function save() {
  const b = await blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = fileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function share() {
  const file = new File([await blob()], fileName(), { type: "image/png" });
  try { await navigator.share({ files: [file] }); } catch (e) { /* cancelled */ }
}

// ---------- wiring
let t = null;
$("#q").addEventListener("input", (e) => {
  clearTimeout(t);
  t = setTimeout(() => {
    $("#editor").hidden = true; $("#bar").hidden = true; $("#results").hidden = false; $("#status").hidden = false;
    showResults(search(e.target.value));
  }, 120);
});
$("#f").addEventListener("input", (e) => {
  if (e.target.name === "qrpick") $("#f").elements.qr.value = e.target.value;
  if (e.target.classList) e.target.classList.remove("typ");
  draw();
});
$("#f").addEventListener("submit", (e) => e.preventDefault());
$("#back").onclick = () => {
  $("#editor").hidden = true; $("#bar").hidden = true; $("#results").hidden = false; $("#status").hidden = false;
  $("#q").focus();
};
$("#save").onclick = save;
$("#share").onclick = share;
try {
  if (navigator.canShare && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] })) $("#share").hidden = false;
} catch (e) { /* no share */ }

Promise.all([loadData(), LabelRender.loadFonts("fonts/")])
  .then(() => { if ($("#q").value) showResults(search($("#q").value)); })
  .catch((e) => { $("#status").textContent = "Could not load the database: " + e.message; });

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js");
