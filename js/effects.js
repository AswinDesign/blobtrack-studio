/* Background post effects and screen overlays */
import { rgbToHsl, hslToRgb } from './color.js';

const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

function buildThermal() {
  const stops = [
    [0.0, [4, 4, 10]],
    [0.16, [24, 0, 62]],
    [0.34, [104, 12, 112]],
    [0.52, [204, 32, 70]],
    [0.7, [248, 118, 34]],
    [0.86, [255, 196, 64]],
    [1.0, [255, 255, 226]],
  ];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    }
    const f = (t - a[0]) / Math.max(0.0001, b[0] - a[0]);
    lut[i * 3] = a[1][0] + (b[1][0] - a[1][0]) * f;
    lut[i * 3 + 1] = a[1][1] + (b[1][1] - a[1][1]) * f;
    lut[i * 3 + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
  }
  return lut;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export class Fx {
  constructor() {
    this.fx = makeCanvas(640, 360);
    this.fxCtx = this.fx.getContext('2d', { willReadFrequently: true });
    this.thermal = buildThermal();
    this.noise = null;
    this.scanPattern = null;
    this.particles = [];
    this.w = 0;
    this.h = 0;
    this.vignette = null;
    this.vignetteKey = '';
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.vignette = null;
    this.particles = [];
    const count = Math.round((w * h) / 42000);
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 8,
        vy: -4 - Math.random() * 14,
        r: 0.7 + Math.random() * 2.1,
        a: 0.08 + Math.random() * 0.4,
        tw: Math.random() * Math.PI * 2,
      });
    }
    this.noise = null;
    this.scanPattern = null;
  }

  setFxSize(w, h) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (this.fx.width !== w || this.fx.height !== h) {
      this.fx.width = w;
      this.fx.height = h;
    }
  }

  post(ctx, w, h, state, time) {
    switch (state.effect) {
      case 'thermal': return this.thermalFx(ctx, w, h, state);
      case 'dither': return this.ditherFx(ctx, w, h, state, time);
      case 'xray': return this.xrayFx(ctx, w, h, state);
      case 'edge': return this.edgeFx(ctx, w, h, state);
      case 'glitch': return this.glitchFx(ctx, w, h, state, time);
      case 'glow': return this.glowFx(ctx, w, h, state);
      case 'invert': return this.invertFx(ctx, w, h, state);
      default: return;
    }
  }

  thermalFx(ctx, w, h, state) {
    const fw = Math.min(640, w);
    const fh = Math.round(fw * (h / w));
    this.setFxSize(fw, fh);
    this.fxCtx.clearRect(0, 0, fw, fh);
    this.fxCtx.drawImage(ctx.canvas, 0, 0, fw, fh);
    const img = this.fxCtx.getImageData(0, 0, fw, fh);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      const k = lum * 3;
      d[i] = this.thermal[k];
      d[i + 1] = this.thermal[k + 1];
      d[i + 2] = this.thermal[k + 2];
      d[i + 3] = 255;
    }
    this.fxCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fx, 0, 0, w, h);
  }

  ditherFx(ctx, w, h, state) {
    const strength = state.effectStrength / 100;
    const block = 3 + Math.round(strength * 7);
    const fw = Math.max(24, Math.round(w / block));
    const fh = Math.max(14, Math.round(h / block));
    this.setFxSize(fw, fh);
    this.fxCtx.clearRect(0, 0, fw, fh);
    this.fxCtx.drawImage(ctx.canvas, 0, 0, fw, fh);
    const img = this.fxCtx.getImageData(0, 0, fw, fh);
    const d = img.data;
    const spread = 54 + strength * 92;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const i = (y * fw + x) * 4;
        const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const b = BAYER[(y & 7) * 8 + (x & 7)] / 64 - 0.5;
        const v = lum + b * spread;
        const on = v > 118;
        d[i] = on ? 234 : 6;
        d[i + 1] = on ? 255 : 8;
        d[i + 2] = on ? 220 : 12;
        d[i + 3] = 255;
      }
    }
    this.fxCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.fx, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  xrayFx(ctx, w, h, state) {
    const fw = Math.min(720, w);
    const fh = Math.round(fw * (h / w));
    this.setFxSize(fw, fh);
    this.fxCtx.clearRect(0, 0, fw, fh);
    this.fxCtx.drawImage(ctx.canvas, 0, 0, fw, fh);
    const img = this.fxCtx.getImageData(0, 0, fw, fh);
    const d = img.data;
    const tint = 0.5 + state.effectStrength / 200;
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const v = 255 - lum;
      d[i] = v * 0.55 * tint;
      d[i + 1] = v * 0.88 * tint;
      d[i + 2] = v * 1.1 * tint;
      d[i + 3] = 255;
    }
    this.fxCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fx, 0, 0, w, h);
  }

  edgeFx(ctx, w, h, state) {
    const fw = Math.min(640, w);
    const fh = Math.round(fw * (h / w));
    this.setFxSize(fw, fh);
    this.fxCtx.clearRect(0, 0, fw, fh);
    this.fxCtx.drawImage(ctx.canvas, 0, 0, fw, fh);
    const src = this.fxCtx.getImageData(0, 0, fw, fh).data;
    const gray = new Uint8ClampedArray(fw * fh);
    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      gray[p] = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
    }
    const out = new ImageData(fw, fh);
    const d = out.data;
    const gain = 0.9 + (state.effectStrength / 100) * 3.2;
    for (let y = 1; y < fh - 1; y++) {
      for (let x = 1; x < fw - 1; x++) {
        const p = y * fw + x;
        const gx =
          -gray[p - fw - 1] + gray[p - fw + 1] +
          -2 * gray[p - 1] + 2 * gray[p + 1] +
          -gray[p + fw - 1] + gray[p + fw + 1];
        const gy =
          -gray[p - fw - 1] - 2 * gray[p - fw] - gray[p - fw + 1] +
          gray[p + fw - 1] + 2 * gray[p + fw] + gray[p + fw + 1];
        const mag = Math.min(255, Math.hypot(gx, gy) * gain);
        const i = p * 4;
        d[i] = 190 + mag * 0.25;
        d[i + 1] = 235 + mag * 0.08;
        d[i + 2] = 255;
        d[i + 3] = mag > 18 ? Math.min(235, mag) : 0;
      }
    }
    this.fxCtx.putImageData(out, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fx, 0, 0, w, h);
    ctx.restore();
  }

  glitchFx(ctx, w, h, state, time) {
    const s = state.effectStrength / 100;
    const count = Math.round(6 + s * 18);
    ctx.save();
    for (let i = 0; i < count; i++) {
      const sy = Math.random() * h;
      const sh = 3 + Math.random() * (h * 0.06);
      const dx = (Math.random() - 0.5) * s * w * 0.14;
      ctx.drawImage(ctx.canvas, 0, sy, w, sh, dx, sy, w, sh);
    }
    if (s > 0.15) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.1 + s * 0.16;
      ctx.filter = 'hue-rotate(110deg) saturate(2.4)';
      ctx.drawImage(ctx.canvas, (Math.random() - 0.5) * 14 * s, 0);
      ctx.filter = 'hue-rotate(-90deg) saturate(2)';
      ctx.globalAlpha = 0.08 + s * 0.12;
      ctx.drawImage(ctx.canvas, (Math.random() - 0.5) * 14 * s, 0);
      ctx.filter = 'none';
    }
    if (Math.random() < 0.16) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.08})`;
      ctx.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2);
    }
    ctx.restore();
  }

  glowFx(ctx, w, h, state) {
    const s = state.effectStrength / 100;
    const fw = Math.max(32, Math.round(w / 4));
    const fh = Math.max(18, Math.round(h / 4));
    this.setFxSize(fw, fh);
    this.fxCtx.clearRect(0, 0, fw, fh);
    this.fxCtx.drawImage(ctx.canvas, 0, 0, fw, fh);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + s * 0.45;
    ctx.filter = `blur(${6 + s * 34}px) brightness(1.6) saturate(1.25)`;
    ctx.drawImage(this.fx, 0, 0, w, h);
    ctx.restore();
  }

  invertFx(ctx, w, h, state) {
    const style = state.invertStyle || 'negative';
    const mix = Math.max(0, Math.min(1, state.effectStrength / 100));
    if (mix <= 0) return;

    const hslStyle = style === 'hue' || style === 'saturation';
    const fw = Math.min(hslStyle ? 520 : 720, w);
    const fh = Math.max(16, Math.round(fw * (h / w)));
    this.setFxSize(fw, fh);
    this.fxCtx.clearRect(0, 0, fw, fh);
    this.fxCtx.drawImage(ctx.canvas, 0, 0, fw, fh);
    const img = this.fxCtx.getImageData(0, 0, fw, fh);
    const d = img.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      let nr;
      let ng;
      let nb;

      if (style === 'red') {
        nr = 255 - r; ng = g; nb = b;
      } else if (style === 'green') {
        nr = r; ng = 255 - g; nb = b;
      } else if (style === 'blue') {
        nr = r; ng = g; nb = 255 - b;
      } else if (style === 'luminance') {
        nr = ng = nb = 255 - (r * 0.299 + g * 0.587 + b * 0.114);
      } else if (hslStyle) {
        const [hue, sat, light] = rgbToHsl(r, g, b);
        const nextHue = style === 'hue' ? (hue + 0.5) % 1 : hue;
        const nextSat = style === 'saturation' ? 1 - sat : sat;
        [nr, ng, nb] = hslToRgb(nextHue, nextSat, light);
      } else {
        nr = 255 - r; ng = 255 - g; nb = 255 - b;
      }

      d[i] = r + (nr - r) * mix;
      d[i + 1] = g + (ng - g) * mix;
      d[i + 2] = b + (nb - b) * mix;
      d[i + 3] = 255;
    }

    this.fxCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fx, 0, 0, w, h);
  }

  overlays(ctx, w, h, state, time, dt) {
    const k = h / 1080;

    if (state.scanlines) {
      if (!this.scanPattern) {
        const c = makeCanvas(1, 3);
        const cctx = c.getContext('2d');
        cctx.fillStyle = 'rgba(0,0,0,.5)';
        cctx.fillRect(0, 2, 1, 1);
        this.scanPattern = ctx.createPattern(c, 'repeat');
      }
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.scanPattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (state.grid) {
      const step = Math.max(24, 64 * k);
      ctx.save();
      ctx.lineWidth = Math.max(1, k);
      ctx.strokeStyle = 'rgba(143,208,255,.11)';
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(200,255,77,.12)';
      ctx.lineWidth = Math.max(1, 1.5 * k);
      ctx.beginPath();
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.restore();
    }

    if (state.particles && this.particles.length) {
      const palette = state.separateColors ? null : state.color;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.tw += dt * 2;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        const a = p.a * (0.55 + 0.45 * Math.sin(p.tw));
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = palette || '#dffcff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.6, p.r * k), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (state.vignette) {
      const key = `${w}x${h}`;
      if (!this.vignette || this.vignetteKey !== key) {
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.hypot(w, h) * 0.62);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.72, 'rgba(0,0,0,.22)');
        g.addColorStop(1, 'rgba(0,0,0,.72)');
        this.vignette = g;
        this.vignetteKey = key;
      }
      ctx.save();
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (state.grain > 0) {
      if (!this.noise) {
        const nc = makeCanvas(160, 160);
        const nctx = nc.getContext('2d');
        const img = nctx.createImageData(160, 160);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255;
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = Math.random() < 0.55 ? Math.random() * 110 : 0;
        }
        nctx.putImageData(img, 0, 0);
        this.noise = nc;
      }
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, (state.grain / 100) * 0.55);
      ctx.globalCompositeOperation = 'overlay';
      const ox = Math.random() * 160;
      const oy = Math.random() * 160;
      ctx.translate(-ox, -oy);
      ctx.fillStyle = ctx.createPattern(this.noise, 'repeat');
      ctx.fillRect(0, 0, w + 160, h + 160);
      ctx.restore();
    }

    if (state.blink) {
      const amp = 0.06 + (state.effectStrength / 100) * 0.12;
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${(0.5 + 0.5 * Math.sin(time * 9)) * amp})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (state.frame) {
      const inset = 16 * k;
      const rad = 10 * k;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = Math.max(1, 1.5 * k);
      ctx.beginPath();
      ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, rad);
      ctx.stroke();
      const arm = 30 * k;
      ctx.strokeStyle = 'rgba(200,255,77,.85)';
      ctx.lineWidth = Math.max(1.5, 2.5 * k);
      ctx.beginPath();
      ctx.moveTo(inset, inset + arm); ctx.lineTo(inset, inset); ctx.lineTo(inset + arm, inset);
      ctx.moveTo(w - inset - arm, inset); ctx.lineTo(w - inset, inset); ctx.lineTo(w - inset, inset + arm);
      ctx.moveTo(w - inset, h - inset - arm); ctx.lineTo(w - inset, h - inset); ctx.lineTo(w - inset - arm, h - inset);
      ctx.moveTo(inset + arm, h - inset); ctx.lineTo(inset, h - inset); ctx.lineTo(inset, h - inset - arm);
      ctx.stroke();
      ctx.restore();
    }

    if (state.watermark) {
      const fs = Math.max(10, 12 * k);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.font = `600 ${fs}px ui-monospace, monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('BLOBTRACK', w - 18 * k, h - 16 * k);
      ctx.restore();
    }
  }
}
