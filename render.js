// Phomemo M02 sticker renderer: port of prototype/render_ref.py (reference style).
// 384 px wide (48 mm @ 203 dpi), 1-bit, auto length. Coordinates match the Python prototype.
/* global qrcode */
(function (root) {
  "use strict";
  const W = 384, PAD = 8;
  const QR_MAX = 200;   // ~25 mm; ECC M with 4 px modules (3 px failed the realistic phone test)
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

  function fit(ctx, s, maxW, size, weight = "Bold") {
    while (size > 10) {
      ctx.font = fontStr(size, weight);
      if (ctx.measureText(s).width <= maxW) return size;
      size -= 1;
    }
    return 10;
  }

  // QR as a 1-bit pixel matrix: ECC M, 4 px modules (3 if too big), bar-width reduction
  function qrBlock(url) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const q = qrcode(0, "M");
    q.addData(url, "Byte");
    q.make();
    const n = q.getModuleCount();
    const s = n * 4 <= QR_MAX ? 4 : 3;
    const size = n * s;
    let px = new Uint8Array(size * size); // 1 = black
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (q.isDark(r, c))
          for (let y = r * s; y < (r + 1) * s; y++) px.fill(1, y * size + c * s, y * size + (c + 1) * s);
    // same as Pillow lighter(offset(-1,0)) + lighter(offset(0,-1)), including wrap-around
    for (let k = 0; k < BWR; k++) {
      const o = new Uint8Array(px.length);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          o[i] = px[i] & px[y * size + ((x + 1) % size)] & px[((y + 1) % size) * size + x];
        }
      px = o;
    }
    return { px, size, s, version: q.getModuleCount() };
  }

  // spec: {brand, line, hex, color, rows:[[label,value],...], flags:[...], opened:bool, qr_url}
  function render(spec, canvas) {
    spec = JSON.parse(safe(JSON.stringify(spec)));
    canvas = canvas || document.createElement("canvas");
    canvas.width = W; canvas.height = 1000;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, 1000);
    ctx.fillStyle = "#000"; ctx.textBaseline = "top"; ctx.textAlign = "left";
    const text = (s, x, y, size, weight, opts = {}) => {
      ctx.font = fontStr(size, weight);
      ctx.textAlign = opts.align || "left";
      ctx.textBaseline = opts.base || "top";
      ctx.fillStyle = opts.white ? "#fff" : "#000";
      ctx.fillText(s, x, y);
      ctx.fillStyle = "#000";
    };
    const rect = (x0, y0, x1, y1, white) => {   // inclusive, like Pillow
      ctx.fillStyle = white ? "#fff" : "#000";
      ctx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      ctx.fillStyle = "#000";
    };

    let y = 4;
    // brand wordmark
    const brand = spec.brand || "";
    const bs = fit(ctx, brand, W - 2 * PAD, 44);
    text(brand, PAD, y, bs, "Bold");
    ctx.font = fontStr(bs, "Bold");
    y += Math.ceil(ctx.measureText(brand || "M").actualBoundingBoxDescent) + 6;

    // inverted line bar (left 60%) + hex on the right
    const barW = Math.floor(W * 0.6), bh = 30;
    rect(PAD, y, PAD + barW, y + bh);
    const ls = fit(ctx, spec.line || "", barW - 12, 24, "Regular");
    text(spec.line || "", PAD + 6, y + bh / 2, ls, "Regular", { white: true, base: "middle" });
    if (spec.hex) {
      const hs = fit(ctx, spec.hex, W - PAD - (PAD + barW + 8), 24, "Regular");
      text(spec.hex, W - PAD, y + bh / 2, hs, "Regular", { align: "right", base: "middle" });
    }
    y += bh + 6;

    // colour name (code)
    const cs = fit(ctx, spec.color || "", W - 2 * PAD, 28);
    text(spec.color || "", PAD, y, cs, "Bold");
    y += 34;

    // table left, QR right
    let qx = W, top = y + 8, qh = 0, s = 4, q = null;
    if (spec.qr_url) {
      q = qrBlock(spec.qr_url); s = q.s;
      qx = W - 2 - q.size; top = y + 2 * s; qh = q.size;
    }
    const rows = (spec.rows || []).filter(([, v]) => v);
    const cx = PAD + 104;
    ctx.font = fontStr(19, "Regular");
    let widest = "";
    for (const [, v] of rows) if (ctx.measureText(v).width > ctx.measureText(widest).width) widest = v;
    const vs = fit(ctx, widest, (q ? qx - 2 * s : W - PAD) - cx, 19, "Regular");
    let ty = top;
    for (const [k, v] of rows) {
      text(k + ":", PAD, ty, 19, "Regular");
      text(v, cx, ty, vs, "Regular");
      ty += 23;
    }
    // 1-bit everything drawn so far, then paste the exact QR pixels
    threshold(ctx, W, 1000);
    if (q) {
      const img = ctx.getImageData(qx, top, q.size, q.size);
      for (let i = 0; i < q.px.length; i++) {
        const v = q.px[i] ? 0 : 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, qx, top);
    }
    y = Math.max(ty, top + qh) + 6;

    // flags as compact inverted chips
    const flags = (spec.flags || []).filter(Boolean);
    if (flags.length) {
      const ch = 22; let x = PAD;
      ctx.font = fontStr(17, "cond");
      for (const fl of flags) {
        ctx.font = fontStr(17, "cond");
        const w = Math.round(ctx.measureText(fl).width) + 10;
        if (x + w > W - PAD) { x = PAD; y += ch + 3; }
        rect(x, y, x + w, y + ch);
        text(fl, x + w / 2, y + ch / 2 + 1, 17, "cond", { white: true, align: "center", base: "middle" });
        x += w + 4;
      }
      y += ch + 6;
    }
    if (spec.opened !== false) {
      text("Opened:", PAD, y, 17, "Regular");
      rect(PAD + 66, y + 16, Math.floor(W * 0.6), y + 16);
      y += 22;
    }
    threshold(ctx, W, 1000, q ? { x: qx, y: top, size: q.size } : null);

    // crop to content (auto length)
    const h = y + 6;
    const out = document.createElement("canvas");
    out.width = W; out.height = h;
    out.getContext("2d").drawImage(canvas, 0, 0);
    return out;
  }

  // anti-aliased canvas text -> pure black/white (what the thermal head prints)
  function threshold(ctx, w, h, skip) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (skip) {
        const p = i / 4, x = p % w, y = (p / w) | 0;
        if (x >= skip.x && x < skip.x + skip.size && y >= skip.y && y < skip.y + skip.size) continue;
      }
      const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 128 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  root.LabelRender = { render, loadFonts, qrBlock, W };
})(typeof window !== "undefined" ? window : globalThis);
