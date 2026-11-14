/* Filament Labels: search the bundled database (or make a custom label), edit, render the M02 sticker, save the PNG. */
/* global LabelRender */
"use strict";
const $ = (s) => document.querySelector(s);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
let DB = null, items = [], customs = [], current = null, homeStatus = "";
const FIELDS = ["brand", "line", "color", "hex", "nozzle", "bed", "chamber", "dry", "flow", "td", "qr", "purchased"];
const CHECKS = ["fl_hard", "fl_enc", "fl_hygro", "opened"];
const TYP_FIELDS = ["nozzle", "bed", "chamber", "dry"];

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
  const sel = $("#f").elements.material;
  sel.add(new Option("— none —", ""));
  for (const m of Object.keys(DB.defaults).sort()) sel.add(new Option(m, m));
  loadCustoms();
  $("#ver").textContent = `· db ${data.version}`;
  homeStatus = `${items.length.toLocaleString()} colours from ${data.brands.length} brands. Type to search.`;
  $("#status").textContent = homeStatus;
}

// ---------- saved custom labels (this device only)
const STORE = "filament-labels.custom.v1";
function loadCustoms() {
  try { customs = JSON.parse(localStorage.getItem(STORE) || "[]"); } catch (e) { customs = []; }
  customs.forEach(indexCustom);
}
function indexCustom(c) {
  c.hay = `${c.values.brand} ${c.values.line} ${c.values.material} ${c.values.color}`.toLowerCase();
  c.hayN = norm(c.hay); c.custom = true;
}
function storeCustoms() {
  try { localStorage.setItem(STORE, JSON.stringify(customs.map(({ id, values }) => ({ id, values })))); }
  catch (e) { /* private mode / storage blocked: the label still saves as a PNG */ }
}

// ---------- search
function search(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  for (const it of customs.concat(items)) {
    let score = it.custom ? 3 : 0, ok = true;
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

function row(swatch, top, bottom, onclick, cls) {
  const li = document.createElement("li");
  if (cls) li.className = cls;
  const sw = document.createElement("span"); sw.className = "sw";
  if (swatch.startsWith("#")) sw.style.background = swatch; else sw.textContent = swatch;
  const t = document.createElement("div");
  t.innerHTML = `<div class="r1"></div><div class="r2"></div>`;
  t.children[0].textContent = top; t.children[1].textContent = bottom;
  li.append(sw, t); li.onclick = onclick;
  return li;
}

function showResults(list) {
  const ul = $("#results"); ul.innerHTML = "";
  const q = $("#q").value.trim();
  for (const it of list) {
    if (it.custom) {
      const v = it.values;
      ul.appendChild(row(v.hex && /^#[0-9a-f]{6}$/i.test(v.hex) ? v.hex : "★", `★ ${v.brand} · ${v.line}`,
        `${v.color}${v.nozzle ? ` · ${v.nozzle}` : ""} · saved custom`, () => openCustom(it)));
    } else {
      ul.appendChild(row(it.hex || "#00000000", `${it.f.brand} · ${lineOf(it.f)}`,
        `${it.color}${it.f.noz[0] ? ` · ${range(it.f.noz)}` : ""}`, () => open(it)));
    }
  }
  if (q) ul.appendChild(row("＋", "Custom label", list.length ? "Not listed? Start from a blank label" : "Fill it in yourself",
    () => openCustom(null, q), "custom"));
  if (q) $("#status").textContent = list.length ? `${list.length}${list.length === 60 ? "+" : ""} matches` : "No matches — make a custom label, or try fewer words.";
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

function defaultsFor(material) {
  const m = String(material || "").toUpperCase();
  return DB.defaults[m] || DB.defaults[m.replace(/[-+ ].*$/, "")] || {};
}
const needsEnclosure = (enc) => enc === "required" || enc === "recommended";

// Fill empty (or still-typical) temp fields with the material's typical values. Nozzle / bed / chamber are
// marked "typ"; drying goes in plain (user 2026-11-14: no "typ" on dry values).
function applyMaterial(material, ownEnc) {
  const e = $("#f").elements, d = defaultsFor(material);
  const enc = ownEnc || (d.enc ? d.enc[0] : "");
  const typ = { nozzle: d.noz && range(d.noz), bed: d.bed && range(d.bed),
                chamber: needsEnclosure(enc) && d.cham ? range(d.cham) : "", dry: d.dry && dryStr(d.dry) };
  for (const k of TYP_FIELDS) {
    const el = e[k];
    if (el.value && !el.classList.contains("typ")) continue;      // never overwrite a real value
    if (k === "dry") {
      if (el.value && !el.dataset.dflt) continue;               // a dry value the user typed stays
      el.value = typ[k] || ""; el.dataset.dflt = typ[k] ? "1" : ""; el.classList.remove("typ");
      continue;
    }
    el.value = typ[k] ? `${typ[k]} typ` : "";
    el.classList.toggle("typ", !!typ[k]);
  }
  if (needsEnclosure(enc)) e.fl_enc.checked = true;
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

function setQrOptions(cands, chosen) {
  const e = $("#f").elements, sel = e.qrpick; sel.innerHTML = "";
  for (const c of cands) sel.add(new Option(`${c.label} (${c.u.length} chars)`, c.u));
  sel.add(new Option(cands.length ? "None (no QR)" : "Type a link below, or leave empty for no QR", ""));
  e.qr.value = chosen != null ? chosen : sel.options[0].value;
  if (chosen != null) sel.value = cands.some((c) => c.u === chosen) ? chosen : "";
}

// ---------- navigation: each screen is a history entry, so Android's back swipe moves through the app:
// editor -> search results -> empty search screen (and only then out of the app)
const view = () => (history.state && history.state.v) || "home";
function go(v) { if (view() !== v) history.pushState({ v }, ""); }
function showHome() {
  clearTimeout(t);
  $("#q").value = "";
  $("#editor").hidden = true; $("#bar").hidden = true;
  $("#results").innerHTML = ""; $("#results").hidden = false;
  $("#status").hidden = false; $("#status").textContent = homeStatus || $("#status").textContent;
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", () => {
  if ($("#sizeDlg").open) $("#sizeDlg").close();
  const v = view();
  if (v === "home") showHome();
  else if (v === "results") backToSearch();
  // "editor" is only reached by going forward again; the editor still holds the last label
  else if (current) showEditor($("#src").textContent, !!current.custom);
});

function showEditor(srcText, custom) {
  go("editor");
  $("#src").textContent = srcText;
  $("#customnote").hidden = !custom;
  $("#forget").hidden = !(current && current.saved);
  // copy is offered for database filaments and saved customs, not for a new custom that isn't saved yet
  $("#clone").hidden = !!(current && current.custom && !current.saved);
  $("#clone").textContent = current && current.saved ? "⧉ Duplicate as a new filament" : "⧉ Copy as my own filament";
  $("#results").hidden = true; $("#editor").hidden = false; $("#bar").hidden = false;
  $("#status").hidden = true;
  window.scrollTo(0, 0);
  draw();
}

function open(it) {
  clearTimeout(t);   // a search still pending from typing must not yank the editor away
  current = { item: it };
  const f = it.f, e = $("#f").elements;
  const vals = {
    brand: f.brand, line: lineOf(f), color: it.color, hex: it.hex,
    nozzle: range(f.noz), bed: range(f.bed), chamber: range(f.cham), dry: dryStr(f.dry),
    flow: "", td: it.td != null ? String(it.td) : "",
  };
  for (const [k, v] of Object.entries(vals)) { e[k].value = v; e[k].classList.remove("typ"); }
  e.dry.dataset.dflt = "";
  e.fl_hard.checked = it.ab; e.fl_enc.checked = needsEnclosure(f.enc);
  e.fl_hygro.checked = false; e.opened.checked = true; e.purchased.value = "";
  const m = f.material.toUpperCase();
  e.material.value = DB.defaults[m] ? m : "";
  applyMaterial(f.material, f.enc);
  setQrOptions(qrCandidates(it));
  const srcName = { o: "Open Filament Database", s: "SpoolmanDB", os: "Open Filament Database + SpoolmanDB" }[f.src];
  showEditor(`Source: ${srcName}. Check values against the box before printing.`, false);
}

// saved = a stored custom label (restore exactly); otherwise a blank one, optionally guessing the material from the search text
function openCustom(saved, query) {
  clearTimeout(t);
  current = { custom: true, saved: saved || null };
  const e = $("#f").elements;
  if (saved) {
    const v = saved.values;
    for (const k of FIELDS) { e[k].value = v[k] || ""; e[k].classList.toggle("typ", (v.typ || []).includes(k)); }
    for (const k of CHECKS) e[k].checked = !!v[k];
    e.material.value = v.material || "";
    setQrOptions([], v.qr || "");
  } else {
    for (const k of FIELDS) { e[k].value = ""; e[k].classList.remove("typ"); }
    e.fl_hard.checked = false; e.fl_enc.checked = false; e.fl_hygro.checked = false; e.opened.checked = true;
    const words = String(query || "").toUpperCase().split(/\s+/);
    const guess = Object.keys(DB.defaults).filter((m) => words.includes(m)).sort((a, b) => b.length - a.length)[0] || "";
    e.material.value = guess;
    if (guess) { applyMaterial(guess); e.line.value = guess; }
    setQrOptions([]);
  }
  if (saved) current.basedOn = saved.values.basedOn;
  showEditor(saved ? `Your saved custom label${saved.values.basedOn ? ` (copied from ${saved.values.basedOn})` : ""}.`
    : "Custom label: fill in what's on the box. Pick a material to get typical temps.", true);
  if (!saved) e.brand.focus({ preventScroll: true });
}

// Keep every value on screen (incl. typ marks and the QR choice) but turn it into a new, unsaved custom.
// Saving then stores it as a new ★ filament; the database entry or the original custom is untouched.
function copyAsCustom() {
  const e = $("#f").elements;
  const from = current && current.custom
    ? `your “${[e.brand.value, e.line.value, e.color.value].filter(Boolean).join(" ")}”`
    : `${current.item.f.brand} ${lineOf(current.item.f)} ${current.item.color}`;
  current = { custom: true, saved: null, basedOn: from };
  showEditor(`Copy of ${from}. Change anything, then Save to keep it as your own filament.`, true);
  e.color.focus({ preventScroll: true }); e.color.select();
}

function formValues() {
  const e = $("#f").elements, v = { material: e.material.value, typ: [] };
  if (current && current.basedOn) v.basedOn = current.basedOn;
  for (const k of FIELDS) { v[k] = e[k].value.trim(); if (e[k].classList.contains("typ")) v.typ.push(k); }
  for (const k of CHECKS) v[k] = e[k].checked;
  return v;
}

// yyyy-mm-dd (date input) -> "14 Nov 26" (short enough for the dates row); "" stays blank for handwriting
function fmtDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  if (!m) return "";
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m[2] - 1];
  return `${+m[3]} ${mon} ${m[1].slice(2)}`;
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
    flags, opened: e.opened.checked, purchased: fmtDate(e.purchased.value), qr_url: e.qr.value.trim(),
  };
}

// ---------- image size (mm). The last choice is remembered on this phone and pre-selected next time.
const SIZE_KEY = "filament-labels.size.v1";
const PRESETS = [[48, 48], [48, 40], [48, 30], [40, 40], [30, 30], [48, 60]];
function loadSize() {
  try { const v = JSON.parse(localStorage.getItem(SIZE_KEY) || "null"); if (v) return LabelRender.clampMm(v.w, v.h); } catch (e) { /* none */ }
  return { w: 48, h: 48 };
}
let size = null;   // set on first draw

let lastCanvas = null;
function draw() {
  size = size || loadSize();
  const out = LabelRender.render(spec(), { wMm: size.w, hMm: size.h });
  const c = $("#label"); c.width = out.width; c.height = out.height;
  c.getContext("2d").drawImage(out, 0, 0);
  lastCanvas = out;
  $("#len").textContent = `${size.w} × ${size.h} mm (${out.width} × ${out.height} px) · ink edge to edge · change on Save`;
}

function fileName() {
  const s = spec();
  return ([s.brand, s.line, s.color].map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean).join("_") || "custom-label") + ".png";
}

function blob() { return LabelRender.toPngBlob(lastCanvas); }   // chosen size, tagged 203 dpi

function rememberCustom() {
  if (!current || !current.custom) return;
  const values = formValues();
  if (!values.brand && !values.line && !values.color) return;
  let c = current.saved;
  if (!c) { c = { id: Date.now().toString(36) }; customs.unshift(c); current.saved = c; }
  c.values = values; indexCustom(c); storeCustoms();
  $("#forget").hidden = false;
  $("#clone").hidden = false; $("#clone").textContent = "⧉ Duplicate as a new filament";
}

async function save() {
  rememberCustom();
  const b = await blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = fileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function share() {
  rememberCustom();
  const file = new File([await blob()], fileName(), { type: "image/png" });
  try { await navigator.share({ files: [file] }); } catch (e) { /* cancelled */ }
}

function backToSearch() {
  $("#editor").hidden = true; $("#bar").hidden = true; $("#results").hidden = false; $("#status").hidden = false;
  showResults(search($("#q").value));
}

// ---------- wiring
// (t: the pending-search timer; declared with var so open() can clear it)
var t = null;
$("#q").addEventListener("input", (e) => {
  clearTimeout(t);
  const q = e.target.value.trim();
  if (view() === "editor") history.back();                                 // typing in the editor -> back to results
  else if (q && view() === "home") go("results");
  else if (!q && view() === "results") { history.back(); return; }        // empty box = the main search screen
  t = setTimeout(() => {
    $("#editor").hidden = true; $("#bar").hidden = true; $("#results").hidden = false; $("#status").hidden = false;
    showResults(search(e.target.value));
  }, 120);
});
$("#f").addEventListener("input", (e) => {
  if (e.target.name === "qrpick") $("#f").elements.qr.value = e.target.value;
  else if (e.target.name === "material") applyMaterial(e.target.value);
  else if (e.target.classList) { e.target.classList.remove("typ"); if (e.target.dataset) e.target.dataset.dflt = ""; }
  draw();
});
$("#f").addEventListener("submit", (e) => e.preventDefault());
$("#back").onclick = () => { if (view() === "editor") history.back(); else backToSearch(); };
$("#forget").onclick = () => {
  if (!current || !current.saved || !confirm("Delete this saved custom label from this phone?")) return;
  customs = customs.filter((c) => c !== current.saved); storeCustoms();
  current.saved = null;
  if (view() === "editor") history.back(); else backToSearch();
};
$("#clone").onclick = copyAsCustom;
// Save / Share first ask for the size (pre-filled with the last choice), then write the PNG at that size
let dlgAction = "save", dlgSize = null;
function dlgShow(w, h, force) {
  dlgSize = LabelRender.clampMm(w, h);
  const f = $("#sizeForm").elements;
  if (force || document.activeElement !== f.w) f.w.value = dlgSize.w;
  if (force || document.activeElement !== f.h) f.h.value = dlgSize.h;
  for (const b of $("#presets").children) b.classList.toggle("on", b.dataset.w == dlgSize.w && b.dataset.h == dlgSize.h);
  const out = LabelRender.render(spec(), { wMm: dlgSize.w, hMm: dlgSize.h });
  const c = $("#dlgCanvas"); c.width = out.width; c.height = out.height; c.getContext("2d").drawImage(out, 0, 0);
  c.style.width = `${Math.round(out.width / 2)}px`;
  $("#dlgInfo").textContent = `${out.width} × ${out.height} px at 203 dpi = ${dlgSize.w} × ${dlgSize.h} mm of ink.`;
  const qm = out.labelInfo.qrModule;
  $("#dlgWarn").hidden = !(qm && qm < 4);
  $("#dlgWarn").textContent = qm && qm < 4 ? `The QR is small at this size (${qm} px modules); it may not scan. 4+ px is tested reliable — go bigger, or set the QR link to None.` : "";
}
function openSizeDialog(action) {
  dlgAction = action;
  $("#sizeOk").textContent = action === "share" ? "Share" : "Save PNG";
  const cur = size || loadSize();
  dlgShow(cur.w, cur.h);
  $("#sizeDlg").showModal();
}
for (const [w, h] of PRESETS) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = w === h ? `${w} × ${h} square` : `${w} × ${h}`; b.dataset.w = w; b.dataset.h = h;
  b.onclick = () => dlgShow(w, h);
  $("#presets").appendChild(b);
}
$("#sizeForm").addEventListener("input", () => { const f = $("#sizeForm").elements; if (f.w.value && f.h.value) dlgShow(f.w.value, f.h.value); });
$("#sizeForm").addEventListener("change", () => { const f = $("#sizeForm").elements; dlgShow(f.w.value, f.h.value, true); });  // snap to the clamped values on blur
$("#sizeCancel").onclick = () => $("#sizeDlg").close();
$("#sizeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = $("#sizeForm").elements; dlgShow(f.w.value, f.h.value);
  size = dlgSize;
  try { localStorage.setItem(SIZE_KEY, JSON.stringify(size)); } catch (err) { /* not remembered, still saves */ }
  $("#sizeDlg").close();
  draw();
  if (dlgAction === "share") share(); else save();
});
$("#save").onclick = () => openSizeDialog("save");
$("#share").onclick = () => openSizeDialog("share");
try {
  if (navigator.canShare && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] })) $("#share").hidden = false;
} catch (e) { /* no share */ }

history.replaceState({ v: "home" }, "");                                  // the app's first screen
Promise.all([loadData(), LabelRender.loadFonts("fonts/")])
  .then(() => { if ($("#q").value) showResults(search($("#q").value)); })
  .catch((e) => { $("#status").textContent = "Could not load the database: " + e.message; });

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js");
