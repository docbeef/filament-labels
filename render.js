// Phomemo M02 sticker renderer, reference style (after prototype/render_ref.py).
// Output: exactly the chosen size (default 48 x 48 mm = 384 x 384 px at 8 dots/mm), 1-bit, and the INK
// touches all four edges: no white margin (user spec 2026-11-14). The 53 mm roll's paper margin is the
// QR's quiet zone on the right and bottom. Width is capped at 48 mm, the M02's print width.
//   top    : brand wordmark          left  : the black line bar (x = 0)
//   right  : QR (or hex / full bar)  bottom: QR, else the "Opened" rule, else the last pinned row
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
  // Module size: the largest of 5..2 px that fits maxSize (4+ px is the tested-reliable range).
  function qrBlock(url, maxSize) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const q = qrcode(0, "M");
    q.addData(url, "Byte");
    q.make();
    const n = q.getModuleCount();
    const s = [5, 4, 3, 2].find((k) => n * k <= maxSize) || 2;
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

    // ---- header (shifted by adj.top so its ink starts on row 0)
    let y = adj.top;
    const brand = spec.brand || "";
    const bm = F(brand, W, 52 * k, "Bold");
    put(brand, bm, 0, y + bm.a);
    y += bm.a + Math.max(bm.d, 0) + K(6);

    const hasQr = !!spec.qr_url, hex = spec.hex || "";
    const barW = hex || hasQr ? Math.floor(W * 0.62) : W;    // full-width bar keeps the right edge inked
    const bh = K(34);
    rect(0, y, barW - 1, y + bh - 1);
    const line = spec.line || "";
    const lm = F(line, barW - K(14), 27 * k, "Regular");
    put(line, lm, K(7), y + bh / 2 + (lm.a - lm.d) / 2, true);
    if (hex) {
      const hm = F(hex, W - barW - K(10), 27 * k, "Regular");
      put(hex, hm, W - hm.w + adj.hexRight, y + bh / 2 + (hm.a - hm.d) / 2);
    }
    y += bh + K(7);

    const color = spec.color || "";
    const cm = F(color, W, 32 * k, "Bold");
    put(color, cm, 0, y + cm.a);
    const headerBottom = Math.ceil(y + cm.a + Math.max(cm.d, 0));

    // ---- QR, bottom-right corner (ink to the right and bottom edges)
    let q = null, colW = W;
    if (hasQr) {
      const room = Math.min(H - headerBottom - K(10), Math.floor(W * 0.55));   // leave the table half the width
      q = qrBlock(spec.qr_url, room);
      colW = W - q.size - 2 * q.s;                 // 2-module quiet zone to the left of the QR
    }

    // ---- bottom group, pinned to the bottom edge: flags then "Opened:" with its rule on the last row
    let bottom = H;
    const flags = (spec.flags || []).filter(Boolean);
    const opened = spec.opened !== false;
    if (opened) {
      const om = M("Opened:", 19 * k, "Regular");
      const base = H - 1 - om.d - 1;               // text sits just above the rule row
      put("Opened:", om, 0, base);
      rect(om.w + K(6), H - 1, colW - 1, H - 1);   // rule on the very last row
      bottom = base - om.a - K(6);
    }
    if (flags.length) {
      const ch = K(24), gap = K(3), fm = (s) => M(s, 18 * k, "cond");
      const rows = [[]]; let x = 0;
      for (const fl of flags) {
        const w = Math.round(fm(fl).w) + K(12);
        if (x && x + w > colW) { rows.push([]); x = 0; }
        rows[rows.length - 1].push([fl, w, x]); x += w + K(4);
      }
      const base = opened ? bottom : H;
      let top = base - rows.length * (ch + gap) + gap;
      for (const r of rows) {
        for (const [fl, w, x0] of r) {
          rect(x0, top, x0 + w - 1, top + ch - 1);
          const m = fm(fl);
          put(fl, m, x0 + (w - m.w) / 2, top + ch / 2 + (m.a - m.d) / 2, true);
        }
        top += ch + gap;
      }
      bottom = base - rows.length * (ch + gap) - gap;
    }

    // ---- table, top-aligned under the header (pinned to the bottom when nothing else reaches it)
    const rows = (spec.rows || []).filter(([, v]) => v);
    const tableTop = headerBottom + K(12);
    const pinBottom = !hasQr && !opened && !flags.length && rows.length;
    const avail = (pinBottom ? H : bottom) - tableTop;
    // largest text (up to 28 px at full width) whose rows fit the height and where label + widest value fit beside
    // the QR; below 12 px only the height has to fit and the values shrink on their own instead
    let size = Math.max(10, Math.round(28 * W / 384)), pitch, labW, labs;
    const widestAt = (sz) => Math.max(0, ...rows.map(([, v]) => M(v, sz, "Regular").w));
    for (;;) {
      pitch = size + Math.max(2, Math.round(size * 0.3));
      labs = rows.map(([lab]) => M(lab + ":", size, "Regular"));
      labW = Math.max(0, ...labs.map((m) => m.w));
      const fitsH = rows.length * pitch <= avail;
      const fitsW = labW + K(10) + widestAt(size) <= colW;
      if ((fitsH && (fitsW || size <= 11)) || size <= 10) break;
      size--;
    }
    // spread the rows over spare height (all of it when the table is what reaches the bottom edge)
    if (rows.length) {
      const spare = avail - rows.length * pitch;
      if (pinBottom) pitch = Math.max(pitch, Math.floor(avail / rows.length));
      else if (spare > 0) pitch += Math.min(Math.floor(spare / rows.length), Math.round(size * 0.6));
    }
    const cx = Math.ceil(labW) + K(10);
    const widest = rows.reduce((best, [, v]) => (M(v, size, "Regular").w > M(best, size, "Regular").w ? v : best), "");
    const vsize = F(widest, colW - cx, size, "Regular").size;
    let ty = pinBottom ? H - rows.length * pitch + adj.bottom : tableTop;
    rows.forEach(([lab, v], i) => {
      const base = ty + labs[i].a + Math.round((pitch - size) / 2);
      put(lab + ":", labs[i], 0, base);
      put(v, M(v, vsize, "Regular"), cx, base);
      ty += pitch;
    });

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
    const x0 = W - q.size, y0 = H - q.size;
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
