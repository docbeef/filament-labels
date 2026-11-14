// Phomemo M02 sticker renderer, reference style (after prototype/render_ref.py).
// Output: exactly the chosen size (default 48 x 48 mm = 384 x 384 px at 8 dots/mm), 1-bit, and the INK
// touches all four edges: no white margin (user spec 2026-11-14). The 53 mm roll's paper margin is the
// QR's quiet zone on the right and bottom. Width is capped at 48 mm, the M02's print width.
//   top    : QR (top-right) or brand left  : the black line bar (x = 0)
//   right  : QR, else the full-width bar  bottom: the "Opened" rule, else flags, else the last pinned row
/* global qrcode */
(function (root) {
  "use strict";
  const DOTS_PER_MM = 8;                 // 203 dpi
  const MAX_W_MM = 48, MIN_MM = 20, MAX_H_MM = 120;
  const BWR = 1;        // QR bar-width reduction (px) to offset thermal bleed; calibrate on a real print
  // Bahnschrift could not ship; Barlow (OFL) stands in. Keep the glyph-safety map anyway.
  const SAFE = { "≥": ">=", "≤": "<=", "℃": "°C", "℉": "°F" };
  // "Regular" text uses Barlow Medium: Barlow Regular is thinner than Bahnschrift and thin strokes fade on thermal paper
  const FAMILY = { Bold: "LabelBold", Regular: "LabelMedium", cond: "LabelCond" };

  let fontsReady = null;
  function loadFonts(base) {
    if (fontsReady) return fontsReady;
    const files = {
      LabelBold: "BarlowSemiCondensed-Bold.ttf",
      LabelMedium: "BarlowSemiCondensed-Medium.ttf",
      LabelCond: "BarlowCondensed-SemiBold.ttf",
    };
    fontsReady = Promise.all(Object.entries(files).map(([fam, file]) => {
      const f = new FontFace(fam, `url(${base || "fonts/"}${file})`);
      return f.load().then((ff) => document.fonts.add(ff));
    }));
    return fontsReady;
  }

  const safe = (s) => String(s ?? "").replace(/[≥≤℃℉]/g, (c) => SAFE[c]);
  const fontStr = (size, weight) => `${size}px ${FAMILY[weight] || FAMILY.Bold}`;
  const clampMm = (w, h) => ({
    w: Math.min(MAX_W_MM, Math.max(MIN_MM, Math.round(Number(w) || MAX_W_MM))),
    h: Math.min(MAX_H_MM, Math.max(MIN_MM, Math.round(Number(h) || MAX_W_MM))),
  });

  // ink box of a string (alphabetic baseline, left aligned): l/r = ink left/right of the pen, a/d = above/below baseline
  function ink(ctx, s, size, weight) {
    ctx.font = fontStr(size, weight); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    if (!s) return { l: 0, r: 0, a: 0, d: 0, w: 0, size };
    const m = ctx.measureText(s);
    return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent,
             d: m.actualBoundingBoxDescent, w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, size };
  }
  function fitInk(ctx, s, maxW, size, weight = "Bold", min = 10) {   // <10 px loses strokes on thermal paper
    size = Math.max(min, Math.round(size));
    let m = ink(ctx, s, size, weight);
    while (size > min && m.w > maxW) m = ink(ctx, s, --size, weight);
    return m;
  }

  // QR as a 1-bit pixel matrix with the bar-width reduction (same as Pillow lighter(offset) incl. wrap-around).
  // Module size: 4 px (tested reliable incl. the realistic phone test), else 3 / 2 when space forces it.
  // Not 5: a bigger QR only steals width from the text (user 2026-11-14: text too small).
  function qrBlock(url, maxSize) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const q = qrcode(0, "M");
    q.addData(url, "Byte");
    q.make();
    const n = q.getModuleCount();
    const s = [4, 3, 2].find((k) => n * k <= maxSize) || 2;
    const size = n * s;
    let px = new Uint8Array(size * size); // 1 = black
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (q.isDark(r, c))
          for (let y = r * s; y < (r + 1) * s; y++) px.fill(1, y * size + c * s, y * size + (c + 1) * s);
    for (let k = 0; k < BWR && s > 2; k++) {
      const o = new Uint8Array(px.length);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          o[i] = px[i] & px[y * size + ((x + 1) % size)] & px[((y + 1) % size) * size + x];
        }
      px = o;
    }
    return { px, size, s, modules: n };
  }

  // spec: {brand, line, hex, color, rows:[[label,value],...], flags:[...], opened:bool, qr_url}
  function layout(ctx, spec, W, H, adj) {
    const k = Math.min(W, H) / 384;              // the design is drawn at 384 x 384 and scaled from there
    const K = (v) => Math.max(1, Math.round(v * k));
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    const rect = (x0, y0, x1, y1, white) => {   // inclusive, like Pillow
      ctx.fillStyle = white ? "#fff" : "#000";
      ctx.fillRect(Math.round(x0), Math.round(y0), Math.round(x1 - x0 + 1), Math.round(y1 - y0 + 1));
      ctx.fillStyle = "#000";
    };
    const put = (s, m, inkLeft, baseline, white) => {   // draw so the ink's left edge lands on inkLeft
      ctx.font = fontStr(m.size, m.weight); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = white ? "#fff" : "#000";
      ctx.fillText(s, inkLeft + m.l, baseline);
      ctx.fillStyle = "#000";
    };
    const M = (s, size, weight) => Object.assign(ink(ctx, s, Math.max(10, Math.round(size)), weight), { weight });
    const F = (s, maxW, size, weight) => Object.assign(fitInk(ctx, s, maxW, size, weight), { weight });

    // ---- QR, TOP-right corner (user 2026-11-14: text too small). Up here it only shares height with the header,
    // so the table below gets the full width. Ink reaches the top and right edges.
    const hasQr = !!spec.qr_url, hex = spec.hex || "";
    let q = null, hw = W;                                       // hw: header width left of the QR
    if (hasQr) {
      q = qrBlock(spec.qr_url, Math.min(Math.floor(W * 0.55), Math.floor(H * 0.55)));   // room for 4 px modules on product-page links
      hw = W - q.size - 2 * q.s;                                // 2-module quiet zone left of the QR
    }

    // ---- header, left of the QR (shifted by adj.top so its ink starts on row 0 when there is no QR)
    let y = q ? 0 : adj.top;
    const brand = spec.brand || "";
    const bm = F(brand, hw, 52 * k, "Bold");
    put(brand, bm, 0, y + bm.a);
    y += bm.a + Math.max(bm.d, 0) + K(6);

    // black line bar with the hex code inside it on the right; full width (to the right edge) when there's no QR
    const barW = q ? hw : W;
    const bh = K(36);
    rect(0, y, barW - 1, y + bh - 1);
    let hm = null;
    if (hex) hm = F(hex, barW * 0.42, 22 * k, "Bold");
    const line = spec.line || "";
    const lm = F(line, barW - K(14) - (hm ? hm.w + K(10) : 0), 30 * k, "Bold");
    put(line, lm, K(7), y + bh / 2 + (lm.a - lm.d) / 2, true);
    if (hm) put(hex, hm, barW - K(7) - hm.w, y + bh / 2 + (hm.a - hm.d) / 2, true);
    y += bh + K(6);

    const color = spec.color || "";
    const cm = F(color, hw, 38 * k, "Bold");
    put(color, cm, 0, y + cm.a);
    const textBottom = Math.ceil(y + cm.a + Math.max(cm.d, 0));
    const headerBottom = Math.max(textBottom, q ? q.size + 2 * q.s : 0);   // QR's quiet zone below it

    // ---- bottom group, full width, pinned to the bottom edge: flags then "Opened:" with its rule on the last row
    let bottom = H;
    const flags = (spec.flags || []).filter(Boolean);
    const opened = spec.opened !== false;
    if (opened) {
      // "Purchased: ____   Opened: ____" on one bold row; the writing rules (2 px) sit on the bottom edge.
      // A purchased date from the form prints instead of its rule.
      const purchased = spec.purchased || "";
      const lineH = Math.max(2, K(2)), gapX = K(14);
      let size = Math.round(27 * k), pm, om, dm, ruleW;
      for (;; size--) {
        pm = M("Purchased:", size, "Bold"); om = M("Opened:", size, "Bold");
        dm = purchased ? M(purchased, size, "Bold") : null;
        const fixed = pm.w + om.w + (dm ? dm.w + K(6) : 0) + 2 * K(6) + gapX;
        ruleW = Math.floor((W - fixed) / (dm ? 1 : 2));
        if (ruleW >= K(50) || size <= 10) break;
      }
      const base = H - lineH - 1 - Math.max(pm.d, om.d, 0);   // text sits just above the rules
      let x = 0;
      put("Purchased:", pm, x, base); x += pm.w + K(6);
      if (dm) { put(purchased, dm, x, base); x += dm.w; }
      else { rect(x, H - lineH, x + ruleW - 1, H - 1); x += ruleW; }
      x += gapX;
      put("Opened:", om, x, base); x += om.w + K(6);
      rect(x, H - lineH, W - 1, H - 1);                        // Opened's rule runs to the right edge
      bottom = base - Math.max(pm.a, om.a) - K(8);
    }
    if (flags.length) {
      const ch = K(26), gap = K(4), fm = (s) => M(s, 21 * k, "cond");   // the usual three flags fit one row
      const frows = [[]]; let x = 0;
      for (const fl of flags) {
        const w = Math.round(fm(fl).w) + K(12);
        if (x && x + w > W) { frows.push([]); x = 0; }
        frows[frows.length - 1].push([fl, w, x]); x += w + K(5);
      }
      const base = opened ? bottom : H;
      let top = base - frows.length * (ch + gap) + gap;
      for (const r of frows) {
        for (const [fl, w, x0] of r) {
          rect(x0, top, x0 + w - 1, top + ch - 1);
          const m = fm(fl);
          put(fl, m, x0 + (w - m.w) / 2, top + ch / 2 + (m.a - m.d) / 2, true);
        }
        top += ch + gap;
      }
      bottom = base - frows.length * (ch + gap) - gap;
    }

    // ---- table between the header and the bottom group (pinned to the bottom edge when nothing else reaches it).
    // A row level with the QR gets the column left of it (hw); a row below the QR gets the full width.
    // Two starting points are tried, right under the header text (rows beside the QR: best on short labels) and
    // right under the QR (all rows full width: best on square/tall labels); the one giving the larger text wins.
    // Labels: Barlow Condensed SemiBold (bold but narrow); values: Barlow Semi Condensed Bold.
    const SHORT = { "Bed Temp": "Bed", "Flow Ratio": "Flow" };   // short labels leave the values more room
    const rows = (spec.rows || []).filter(([, v]) => v).map(([lab, v]) => [SHORT[lab] || lab, v]);
    const qBand = q ? q.size + 2 * q.s : 0;                     // QR + its quiet zone below
    const pinBottom = !opened && !flags.length && rows.length;
    const limitY = pinBottom ? H : bottom;
    const LAB = "cond", VAL = "Bold";
    const plan = (top, size, spread) => {
      const labs = rows.map(([lab]) => M(lab + ":", size, LAB));
      const cx = Math.ceil(Math.max(0, ...labs.map((m) => m.w))) + K(8);
      const asc = Math.max(M("Nb0°", size, VAL).a, M("Nb", size, LAB).a);
      const rowH = Math.ceil(asc + Math.max(M("y", size, LAB).d, M("0", size, VAL).d, 0));
      const gap = Math.max(2, Math.round(size * 0.16)) + (spread || 0);
      let yy = top, ok = true;
      const pos = rows.map(([, v]) => {
        const lim = yy < qBand ? hw : W;                       // level with the QR -> narrow column
        if (cx + M(v, size, VAL).w > lim) ok = false;
        const p = { base: yy + asc, lim }; yy += rowH + gap; return p;
      });
      const end = yy - gap;
      return { top, size, labs, cx, pos, end, ok: ok && end <= limitY };
    };
    const largest = (top) => {
      for (let size = Math.max(10, Math.round(90 * W / 384)); size >= 10; size--) { const p = plan(top, size); if (p.ok) return p; }
      return null;
    };
    let best = null;
    if (rows.length) {
      const tops = [textBottom + K(8)];
      if (q && headerBottom > textBottom) tops.push(headerBottom + K(8));
      for (const top of tops) { const p = largest(top); if (p && (!best || p.size > best.size)) best = p; }
      if (!best) best = plan(tops[0], 10);                      // too much to fit: smallest text, values shrink
    }
    if (best && rows.length > 1 && !pinBottom) {                // spread spare height between rows, if it still fits
      const spare = Math.floor((limitY - best.end) / (rows.length - 1));
      for (let s = Math.min(spare, Math.round(best.size * 0.5)); s > 0; s--) {
        const p = plan(best.top, best.size, s);
        if (p.ok) { best = p; break; }
      }
    }
    if (best) {
      const shift = pinBottom ? H - best.end + adj.bottom : 0;  // pinned: the block sits on the bottom edge
      rows.forEach(([lab, v], i) => {
        const p = best.pos[i], base = Math.round(p.base + shift);
        put(lab + ":", best.labs[i], 0, base);
        put(v, F(v, p.lim - best.cx, best.size, VAL), best.cx, base);
      });
    }

    return q;
  }

  // opts: { wMm, hMm } (default 48 x 48). Returns the canvas; canvas.labelInfo = { wMm, hMm, qrModule }
  function render(spec, opts = {}) {
    spec = JSON.parse(safe(JSON.stringify(spec)));
    const mm = clampMm(opts.wMm ?? MAX_W_MM, opts.hMm ?? MAX_W_MM);
    const W = mm.w * DOTS_PER_MM, H = mm.h * DOTS_PER_MM;
    const canvas = opts.canvas || document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // pass 1, measure how far the thresholded ink falls short of the edges; pass 2 closes the gap
    const adj = { top: 0, hexRight: 0, bottom: 0 };
    const draw = () => { const q = layout(ctx, spec, W, H, adj); threshold(ctx, W, H); if (q) paste(ctx, q, W, H); return q; };
    let q = draw();
    const b = inkBox(ctx, W, H);
    if (b) {
      adj.top = -b.y0;
      if (!q) adj.hexRight = W - 1 - b.x1;
      adj.bottom = H - 1 - b.y1;
      if (adj.top || adj.hexRight || adj.bottom) q = draw();
    }
    canvas.labelInfo = { wMm: mm.w, hMm: mm.h, qrModule: q ? q.s : 0 };
    return canvas;
  }

  function paste(ctx, q, W, H) {
    const x0 = W - q.size, y0 = 0;                          // top-right corner
    const img = ctx.getImageData(x0, y0, q.size, q.size);
    for (let i = 0; i < q.px.length; i++) {
      const v = q.px[i] ? 0 : 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, x0, y0);
  }

  // anti-aliased canvas text -> pure black/white (what the thermal head prints)
  function threshold(ctx, W, H) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 150 ? 0 : 255;   // a little past 50%: keeps thin strokes of small text
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function inkBox(ctx, W, H) {
    W = W || ctx.canvas.width; H = H || ctx.canvas.height;
    const d = ctx.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (d[(y * W + x) * 4] === 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  // PNG with a pHYs chunk: 8000 px/m = 203.2 dpi, so apps that honour it print it at the chosen mm size
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function toPngBlob(canvas) {
    const png = new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, "image/png"))).arrayBuffer());
    const chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4);            // length 9, "pHYs"
    dv.setUint32(8, 8000); dv.setUint32(12, 8000); chunk[16] = 1;          // px per metre x/y, unit = metre
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const at = 8 + 25;                                                      // after the signature + IHDR
    return new Blob([png.subarray(0, at), chunk, png.subarray(at)], { type: "image/png" });
  }

  root.LabelRender = { render, loadFonts, qrBlock, toPngBlob, inkBox, clampMm, MAX_W_MM, MIN_MM, MAX_H_MM };
})(typeof window !== "undefined" ? window : globalThis);
