/* Source handling, blob detection, tracking and canvas composition */
import { state, getPalette, CALLSIGNS } from './state.js';
import { drawBlob, traceShape } from './shapes.js';
import { invertColor } from './color.js';
import { Fx } from './effects.js';

const ASPECT = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3 };
const DET_WIDTH = { low: 128, medium: 192, high: 256 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function fitRect(sw, sh, dw, dh, mode) {
  const scale = mode === 'contain' ? Math.min(dw / sw, dh / sh) : Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.fx = new Fx();

    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.loop = true;
    this.video.crossOrigin = 'anonymous';

    this.mode = 'demo';
    this.ready = true;
    this.playing = true;
    this.speed = 1;
    this.loop = true;
    this.time = 0;
    this.fps = 60;
    this.tracks = [];
    this.nextId = 1;
    this.cameraStream = null;
    this.videoUrl = null;

    this.roiMode = false;
    this.roiDrag = null;

    this.demo = { canvas: document.createElement('canvas'), t: 0, orbs: [] };
    this.demo.canvas.width = 1280;
    this.demo.canvas.height = 720;
    this.demo.ctx = this.demo.canvas.getContext('2d');
    this.initDemo();

    this.det = {
      canvas: document.createElement('canvas'),
      ctx: null,
      w: 0,
      h: 0,
      mask: null,
      visited: null,
      stack: null,
    };
    this.det.ctx = this.det.canvas.getContext('2d', { willReadFrequently: true });

    this.scratch = document.createElement('canvas');
    this.scratchCtx = this.scratch.getContext('2d');

    this.matte = document.createElement('canvas');
    this.matteCtx = this.matte.getContext('2d');

    this.onSource = null;
    this.onStats = null;
    this._lastTs = 0;
    this._statsClock = 0;
    this._raf = 0;

    this.resizeOutput();
    this.fx.resize(this.canvas.width, this.canvas.height);
  }

  initDemo() {
    const colors = ['#c8ff4d', '#63e6ff', '#ff7ad9', '#ffd166', '#9d8cff', '#4dffb8'];
    this.demo.orbs = colors.map((color, i) => ({
      color,
      phase: i * 1.37 + 0.4,
      fx: 0.19 + i * 0.037,
      fy: 0.23 + (i % 3) * 0.052,
      ax: 0.24 + (i % 2) * 0.09,
      ay: 0.19 + ((i + 1) % 3) * 0.055,
      r: 52 + i * 7,
      wob: 0.7 + i * 0.15,
    }));
  }

  get aspect() { return ASPECT[state.aspect] || 16 / 9; }

  getRenderSize() {
    const ar = this.aspect;
    const short = Number(state.resolution) || 1080;
    let w;
    let h;
    if (ar >= 1) { h = short; w = Math.round(short * ar); }
    else { w = short; h = Math.round(short / ar); }
    return { w: w - (w % 2), h: h - (h % 2), ratio: ar };
  }

  resizeOutput() {
    const { w, h, ratio } = this.getRenderSize();
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.fx.resize(w, h);
      this.det.w = 0;
      this.det.h = 0;
      this.tracks = [];
    }
    this.ratio = ratio;
    return { w, h, ratio };
  }

  start() {
    if (this._raf) return;
    this._lastTs = performance.now();
    const loop = (ts) => {
      const dt = Math.min(0.06, Math.max(0.001, (ts - this._lastTs) / 1000));
      this._lastTs = ts;
      this.tick(dt);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  tick(dt) {
    this.time += dt;
    if (this.mode === 'demo' && this.playing) {
      this.demo.t += dt * this.speed;
      this.drawDemo();
    }

    const fps = 1 / dt;
    this.fps = lerp(this.fps, fps, 0.08);

    this.draw();

    this._statsClock += dt;
    if (this._statsClock > 0.2) {
      this._statsClock = 0;
      this.onStats?.({
        fps: Math.round(this.fps),
        blobs: this.tracks.length,
        mode: this.mode,
        playing: this.isPlaying(),
        ready: this.isReady(),
      });
    }
  }

  /* ---------------- sources ---------------- */

  get sourceEl() {
    return this.mode === 'demo' ? this.demo.canvas : this.video;
  }

  sourceDims() {
    if (this.mode === 'demo') return [1280, 720];
    if (this.video.videoWidth && this.video.videoHeight) {
      return [this.video.videoWidth, this.video.videoHeight];
    }
    return null;
  }

  isReady() {
    if (this.mode === 'demo') return true;
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  isPlaying() {
    if (this.mode === 'demo') return this.playing;
    if (this.mode === 'video') return !this.video.paused && !this.video.ended;
    return true;
  }

  resetTracks() {
    this.tracks = [];
    this.nextId = 1;
  }

  stopCameraStream() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
    if (this.video.srcObject) this.video.srcObject = null;
  }

  async startCamera(deviceId) {
    this.stopCameraStream();
    this.video.pause();
    if (this.videoUrl) { this.video.removeAttribute('src'); this.video.load(); }

    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.cameraStream = stream;
    this.mode = 'camera';
    this.video.muted = true;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    this.resetTracks();
    this.onSource?.('camera');
    return stream;
  }

  useDemo() {
    this.stopCameraStream();
    try { this.video.pause(); } catch { /* noop */ }
    this.mode = 'demo';
    this.playing = true;
    this.resetTracks();
    this.onSource?.('demo');
  }

  async useVideoFile(file) {
    this.stopCameraStream();
    try { this.video.pause(); } catch { /* noop */ }
    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
    this.videoUrl = URL.createObjectURL(file);
    this.video.muted = false;
    this.video.loop = this.loop;
    this.video.src = this.videoUrl;
    this.video.load();

    await new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('Could not decode this video in your browser.')); };
      const cleanup = () => {
        this.video.removeEventListener('loadeddata', done);
        this.video.removeEventListener('error', fail);
      };
      this.video.addEventListener('loadeddata', done, { once: true });
      this.video.addEventListener('error', fail, { once: true });
      setTimeout(() => {
        if (this.video.readyState >= 2) done();
      }, 1500);
    });

    this.mode = 'video';
    this.playing = true;
    this.video.currentTime = 0;
    this.video.playbackRate = this.speed;
    await this.video.play().catch(() => { this.playing = false; });
    this.resetTracks();
    this.onSource?.('video');
    return { duration: this.video.duration || 0, width: this.video.videoWidth, height: this.video.videoHeight };
  }

  togglePlay() {
    if (this.mode === 'demo') {
      this.playing = !this.playing;
    } else if (this.mode === 'video') {
      if (this.video.paused) this.video.play().catch(() => {});
      else this.video.pause();
    }
    return this.isPlaying();
  }

  play() {
    if (this.mode === 'demo') this.playing = true;
    else if (this.mode === 'video') this.video.play().catch(() => {});
  }

  pause() {
    if (this.mode === 'demo') this.playing = false;
    else if (this.mode === 'video') this.video.pause();
  }

  setSpeed(v) {
    this.speed = v;
    if (this.mode === 'video') this.video.playbackRate = v;
  }

  setLoop(loop) {
    this.loop = loop;
    this.video.loop = loop;
  }

  seek(fraction) {
    if (this.mode === 'video' && Number.isFinite(this.video.duration)) {
      this.video.currentTime = clamp(fraction, 0, 1) * this.video.duration;
    }
  }

  setRoiMode(on) {
    this.roiMode = on;
    this.roiDrag = null;
  }

  setRoiDrag(rect) { this.roiDrag = rect; }

  /* ---------------- demo source ---------------- */

  drawDemo() {
    const c = this.demo.ctx;
    const w = 1280;
    const h = 720;
    const t = this.demo.t;

    const bg = c.createRadialGradient(w * 0.5, h * 0.45, 30, w * 0.5, h * 0.5, w * 0.7);
    bg.addColorStop(0, '#0b0f17');
    bg.addColorStop(0.55, '#070a10');
    bg.addColorStop(1, '#040508');
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const x = ((i * 397 + 89) % w);
      const y = ((i * 211 + 47) % h);
      const tw = 0.2 + 0.2 * Math.sin(t * 1.3 + i);
      c.fillStyle = `rgba(150,190,255,${0.03 + tw * 0.05})`;
      c.beginPath();
      c.arc(x, y, 1 + (i % 3) * 0.6, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const o of this.demo.orbs) {
      const px = w * 0.5 + Math.sin(t * o.fx + o.phase) * w * o.ax + Math.sin(t * o.wob + o.phase * 2) * 24;
      const py = h * 0.5 + Math.cos(t * o.fy + o.phase * 1.27) * h * o.ay + Math.cos(t * o.wob * 1.4 + o.phase) * 18;
      const r = o.r * (0.92 + 0.1 * Math.sin(t * 1.1 + o.phase));

      const glow = c.createRadialGradient(px, py, r * 0.1, px, py, r * 2.6);
      glow.addColorStop(0, hexA(o.color, 0.5));
      glow.addColorStop(0.4, hexA(o.color, 0.16));
      glow.addColorStop(1, hexA(o.color, 0));
      c.fillStyle = glow;
      c.beginPath();
      c.arc(px, py, r * 2.6, 0, Math.PI * 2);
      c.fill();

      const body = c.createRadialGradient(px - r * 0.2, py - r * 0.25, 1, px, py, r);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.28, '#f4ffe2');
      body.addColorStop(0.62, o.color);
      body.addColorStop(1, hexA(o.color, 0));
      c.fillStyle = body;
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = 'rgba(255,255,255,.96)';
      c.beginPath();
      c.arc(px, py, r * 0.34, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = hexA(o.color, 0.9);
      c.beginPath();
      c.arc(px + Math.cos(t * 1.7 + o.phase) * r * 1.5, py + Math.sin(t * 1.7 + o.phase) * r * 1.5, 3.4, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /* ---------------- source painting ---------------- */

  paintSource(target, dw, dh, { filter = 'none', fit = state.fit, mirror = state.mirror } = {}) {
    const dims = this.sourceDims();
    if (!dims) return null;
    const [sw, sh] = dims;
    const rect = fitRect(sw, sh, dw, dh, fit);
    target.save();
    if (filter && filter !== 'none') target.filter = filter;
    if (mirror) {
      target.translate(dw, 0);
      target.scale(-1, 1);
    }
    target.drawImage(this.sourceEl, rect.x, rect.y, rect.w, rect.h);
    target.restore();
    return rect;
  }

  drawBackground(w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const s = state.effectStrength / 100;
    const k = h / 1080;

    ctx.save();
    if (state.effect === 'zoom') {
      const z = 1 + s * 0.12 * (0.5 + 0.5 * Math.sin(this.time * 1.1));
      ctx.translate(w / 2, h / 2);
      ctx.scale(z, z);
      ctx.translate(-w / 2, -h / 2);
    }

    if (state.effect === 'pixelate') {
      const block = 4 + s * 46 * Math.max(0.35, k);
      const fw = Math.max(24, Math.round(w / block));
      const fh = Math.max(14, Math.round(h / block));
      if (this.scratch.width !== fw || this.scratch.height !== fh) {
        this.scratch.width = fw;
        this.scratch.height = fh;
      }
      this.scratchCtx.clearRect(0, 0, fw, fh);
      this.paintSource(this.scratchCtx, fw, fh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.scratch, 0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
    } else if (state.effect === 'water') {
      const dims = this.sourceDims();
      if (dims) {
        const [sw, sh] = dims;
        const rect = fitRect(sw, sh, w, h, state.fit);
        const amp = (2 + s * 24) * k;
        const slices = 56;
        ctx.save();
        if (state.mirror) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        const shSlice = sh / slices;
        for (let i = 0; i < slices; i++) {
          const offset = Math.sin(i * 0.42 + this.time * 2.4) * amp;
          ctx.drawImage(
            this.sourceEl, 0, i * shSlice, sw, shSlice + 0.5,
            rect.x + offset, rect.y + (rect.h * i) / slices, rect.w, rect.h / slices + 1,
          );
        }
        ctx.restore();
      }
    } else if (state.effect === 'backdrop') {
      const dims = this.sourceDims();
      if (dims) {
        const [sw, sh] = dims;
        const cover = fitRect(sw, sh, w, h, 'cover');
        const zoom = 1.06;
        ctx.save();
        ctx.filter = `blur(${Math.round((10 + s * 42) * k)}px) brightness(.6) saturate(1.15)`;
        ctx.drawImage(this.sourceEl, cover.x - (cover.w * zoom - cover.w) / 2, cover.y - (cover.h * zoom - cover.h) / 2, cover.w * zoom, cover.h * zoom);
        ctx.restore();

        const contain = fitRect(sw, sh, w, h, 'contain');
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.65)';
        ctx.shadowBlur = 40 * k;
        this.paintSource(ctx, w, h, { fit: 'contain' });
        ctx.restore();
        void contain;
      }
    } else {
      const blur = state.effect === 'blur' ? `blur(${(2 + s * 30) * k}px)` : 'none';
      this.paintSource(ctx, w, h, { filter: blur });
    }
    ctx.restore();
  }

  /* ---------------- detection ---------------- */

  detect() {
    const dims = this.sourceDims();
    if (!dims) return [];
    const ar = this.canvas.width / this.canvas.height;
    const dw = DET_WIDTH[state.detRes] || 192;
    let dh = Math.round(dw / ar);
    dh = Math.max(64, dh - (dh % 2));

    const det = this.det;
    if (det.w !== dw || det.h !== dh) {
      det.w = dw;
      det.h = dh;
      det.canvas.width = dw;
      det.canvas.height = dh;
      det.mask = new Uint8Array(dw * dh);
      det.visited = new Uint8Array(dw * dh);
      det.stack = new Int32Array(dw * dh);
    }

    const ctx = det.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, dw, dh);
    ctx.save();
    if (state.effect === 'zoom') {
      const s = state.effectStrength / 100;
      const z = 1 + s * 0.12 * (0.5 + 0.5 * Math.sin(this.time * 1.1));
      ctx.translate(dw / 2, dh / 2);
      ctx.scale(z, z);
      ctx.translate(-dw / 2, -dh / 2);
    }
    this.paintSource(ctx, dw, dh);
    ctx.restore();

    const [sw, sh] = dims;
    const content = fitRect(sw, sh, dw, dh, state.fit);
    const cx0 = clamp(Math.floor(content.x), 0, dw - 1);
    const cy0 = clamp(Math.floor(content.y), 0, dh - 1);
    const cx1 = clamp(Math.ceil(content.x + content.w), 1, dw);
    const cy1 = clamp(Math.ceil(content.y + content.h), 1, dh);

    let x0 = cx0;
    let y0 = cy0;
    let x1 = cx1;
    let y1 = cy1;
    if (state.roi) {
      const r = state.roi;
      x0 = clamp(Math.floor(r.x * dw), cx0, cx1);
      y0 = clamp(Math.floor(r.y * dh), cy0, cy1);
      x1 = clamp(Math.ceil((r.x + r.w) * dw), cx0, cx1);
      y1 = clamp(Math.ceil((r.y + r.h) * dh), cy0, cy1);
    }
    if (x1 - x0 < 3 || y1 - y0 < 3) return [];

    const img = ctx.getImageData(0, 0, dw, dh).data;
    const mask = det.mask;
    mask.fill(0);
    const threshold = state.threshold;
    const invertMode = state.invertMode || 'off';

    for (let y = y0; y < y1; y++) {
      const row = y * dw;
      for (let x = x0; x < x1; x++) {
        const i = row + x;
        const p = i * 4;
        const r = img[p];
        const g = img[p + 1];
        const b = img[p + 2];
        let signal;
        if (invertMode === 'red') signal = 255 - r;
        else if (invertMode === 'green') signal = 255 - g;
        else if (invertMode === 'blue') signal = 255 - b;
        else if (invertMode === 'saturation') {
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          signal = 255 - (mx ? ((mx - mn) / mx) * 255 : 0);
        } else {
          const lum = r * 0.299 + g * 0.587 + b * 0.114;
          signal = invertMode === 'luminance' ? 255 - lum : lum;
        }
        if (signal >= threshold) mask[i] = 1;
      }
    }

    const visited = det.visited;
    visited.fill(0);
    const stack = det.stack;
    const blobs = [];
    const minArea = Math.max(2, Math.pow(state.minSize / 100, 2) * (x1 - x0) * (y1 - y0) * 0.05);

    for (let y = y0; y < y1; y++) {
      const row = y * dw;
      for (let x = x0; x < x1; x++) {
        const start = row + x;
        if (!mask[start] || visited[start]) continue;

        let sp = 0;
        stack[sp++] = start;
        visited[start] = 1;
        let area = 0;
        let sumX = 0;
        let sumY = 0;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;

        while (sp > 0) {
          const p = stack[--sp];
          const px = p % dw;
          const py = (p / dw) | 0;
          area++;
          sumX += px;
          sumY += py;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;

          if (px > x0 && mask[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1; }
          if (px < x1 - 1 && mask[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1; }
          if (py > y0 && mask[p - dw] && !visited[p - dw]) { visited[p - dw] = 1; stack[sp++] = p - dw; }
          if (py < y1 - 1 && mask[p + dw] && !visited[p + dw]) { visited[p + dw] = 1; stack[sp++] = p + dw; }
        }

        if (area < minArea) continue;
        blobs.push({
          x: sumX / area / dw,
          y: sumY / area / dh,
          w: (maxX - minX + 1) / dw,
          h: (maxY - minY + 1) / dh,
          area,
        });
      }
    }

    blobs.sort((a, b) => b.area - a.area);
    return blobs.slice(0, Math.max(1, state.maxBlobs));
  }

  updateTracks(blobs) {
    const prev = this.tracks;
    const used = new Uint8Array(prev.length);
    const ar = this.canvas.width / this.canvas.height;
    const smooth = (state.smoothing / 100) * 0.85;
    const next = [];

    for (const b of blobs) {
      let best = -1;
      let bestDist = 0.22;
      for (let i = 0; i < prev.length; i++) {
        if (used[i]) continue;
        const dx = (prev[i].x - b.x) * ar;
        const dy = prev[i].y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      if (best >= 0) {
        used[best] = 1;
        const p = prev[best];
        next.push({
          id: p.id,
          x: lerp(b.x, p.x, smooth),
          y: lerp(b.y, p.y, smooth),
          w: lerp(b.w, p.w, smooth),
          h: lerp(b.h, p.h, smooth),
          area: lerp(b.area, p.area, smooth * 0.6),
        });
      } else {
        next.push({ id: this.nextId++, x: b.x, y: b.y, w: b.w, h: b.h, area: b.area });
      }
    }

    this.tracks = next;
    if (this.nextId > 999) this.nextId = 1;
  }

  blobRadius(track) {
    const h = this.canvas.height;
    const size = state.blobSize / 100;
    if (state.uniform) return Math.max(3, h * 0.055 * size);
    const scale = this.det.h ? h / this.det.h : 1;
    const raw = Math.sqrt(track.area) * scale * 0.8 * size;
    return clamp(raw, h * 0.008, h * 0.30);
  }

  colorFor(index) {
    const palette = getPalette();
    const base = state.separateColors ? palette[index % palette.length] : state.color;
    return invertColor(base, state.blobInvert);
  }

  /* ---------------- inverted blob matte ---------------- */

  drawBlobCutout() {
    if (state.blobInvert !== 'cutout' || !this.tracks.length) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const matte = this.matte;
    const mctx = this.matteCtx;

    if (matte.width !== w || matte.height !== h) {
      matte.width = w;
      matte.height = h;
    }

    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = 1;
    mctx.clearRect(0, 0, w, h);
    mctx.globalAlpha = Math.max(0.02, Math.min(1, state.fillOpacity / 100));
    mctx.fillStyle = state.color;
    mctx.fillRect(0, 0, w, h);
    mctx.globalAlpha = 1;
    mctx.globalCompositeOperation = 'destination-out';

    const fillable = new Set(['circle', 'square', 'diamond', 'hex', 'star']);
    for (const t of this.tracks) {
      const r = this.blobRadius(t);
      mctx.save();
      mctx.translate(t.x * w, t.y * h);
      mctx.beginPath();
      if (state.shape === 'ring') {
        mctx.arc(0, 0, r, 0, Math.PI * 2);
        mctx.arc(0, 0, r * 0.6, 0, Math.PI * 2, true);
      } else if (fillable.has(state.shape)) {
        traceShape(mctx, state.shape, r);
      } else {
        mctx.arc(0, 0, r, 0, Math.PI * 2);
      }
      mctx.fill('evenodd');
      mctx.restore();
    }

    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(matte, 0, 0);
    this.ctx.restore();
  }

  /* ---------------- connections ---------------- */

  computePairs(points) {
    const n = points.length;
    if (n < 2) return [];
    const density = state.density / 100;
    const seen = new Set();
    const pairs = [];
    const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const add = (a, b) => {
      const k = key(a, b);
      if (seen.has(k)) return;
      seen.add(k);
      pairs.push({ a, b, d: Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) });
    };

    if (state.connection === 'nearest') {
      for (let i = 0; i < n; i++) {
        let best = -1;
        let bd = Infinity;
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
          if (d < bd) { bd = d; best = j; }
        }
        if (best >= 0) add(i, best);
      }
      pairs.sort((a, b) => a.d - b.d);
      return pairs.slice(0, Math.round(n * 1.2 * density));
    }

    if (state.connection === 'chain') {
      const order = [...Array(n).keys()].sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
      for (let i = 0; i < n - 1; i++) add(order[i], order[i + 1]);
      return pairs.slice(0, Math.max(0, Math.round((n - 1) * density)));
    }

    if (state.connection === 'mesh') {
      const ar = this.canvas.width / this.canvas.height;
      const maxD = 0.15 + (state.linkDistance / 100) * 0.75;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = (points[i].x - points[j].x) * ar;
          const dy = points[i].y - points[j].y;
          const d = Math.hypot(dx, dy);
          if (d < maxD) add(i, j);
        }
      }
      pairs.sort((a, b) => a.d - b.d);
      return pairs.slice(0, Math.min(160, Math.round(n * 2 * density)));
    }

    if (state.connection === 'constellation') {
      const inTree = [0];
      const outside = new Set([...Array(n).keys()].slice(1));
      while (outside.size) {
        let best = null;
        for (const a of inTree) {
          for (const b of outside) {
            const d = Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
            if (!best || d < best.d) best = { a, b, d };
          }
        }
        if (!best) break;
        add(best.a, best.b);
        inTree.push(best.b);
        outside.delete(best.b);
      }
      pairs.sort((a, b) => a.d - b.d);
      return pairs.slice(0, Math.max(0, Math.round((n - 1) * density)));
    }

    return [];
  }

  drawConnections() {
    if (state.connection === 'off' || this.tracks.length < 2) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const k = h / 1080;
    const points = this.tracks.map((t, i) => ({
      x: t.x * w,
      y: t.y * h,
      r: this.blobRadius(t),
      color: state.linkUseBlobColors ? this.colorFor(i) : state.linkColor,
    }));
    const pairs = this.computePairs(points);
    if (!pairs.length) return;

    ctx.save();
    ctx.lineWidth = Math.max(0.5, state.linkWidth * k);
    ctx.lineCap = 'round';
    ctx.setLineDash(state.linkDashed ? [8 * k, 7 * k] : []);
    ctx.shadowBlur = Math.min(14, state.glow * 0.35) * k;
    ctx.shadowColor = state.linkColor;

    for (const { a, b } of pairs) {
      const pa = points[a];
      const pb = points[b];
      let ax = pa.x;
      let ay = pa.y;
      let bx = pb.x;
      let by = pb.y;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 2) continue;

      if (state.connectPoint === 'edge') {
        const offA = pa.r + 3 * k;
        const offB = pb.r + 3 * k;
        if (len <= offA + offB) continue;
        ax += (dx / len) * offA;
        ay += (dy / len) * offA;
        bx -= (dx / len) * offB;
        by -= (dy / len) * offB;
      }

      if (state.linkUseBlobColors) {
        const grad = ctx.createLinearGradient(ax, ay, bx, by);
        grad.addColorStop(0, pa.color);
        grad.addColorStop(1, pb.color);
        ctx.strokeStyle = grad;
      } else {
        ctx.strokeStyle = state.linkColor;
      }
      ctx.globalAlpha = 0.85;

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      if (state.curve) {
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const side = (a + b) % 2 ? 1 : -1;
        const curve = Math.min(70 * k, len * 0.12) * side;
        ctx.quadraticCurveTo(mx - (dy / len) * curve, my + (dx / len) * curve, bx, by);
      } else {
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- blobs / labels ---------------- */

  drawBlobs() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const k = h / 1080;

    this.tracks.forEach((t, i) => {
      const color = this.colorFor(i);
      const r = this.blobRadius(t);
      ctx.save();
      ctx.translate(t.x * w, t.y * h);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = state.glow * k;
      ctx.globalAlpha = 0.98;
      drawBlob(ctx, state, r, k);
      ctx.restore();
    });
  }

  drawLabels() {
    if (!state.showLabels || !this.tracks.length) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const k = h / 1080;
    const fs = Math.max(6, state.labelSize * k);

    ctx.save();
    ctx.font = `700 ${fs}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.labelColor;
    ctx.shadowColor = 'rgba(0,0,0,.85)';
    ctx.shadowBlur = 8 * k;
    ctx.globalAlpha = 0.95;

    this.tracks.forEach((t, i) => {
      let text;
      if (state.labelMode === 'id') text = `#${String(t.id).padStart(2, '0')}`;
      else if (state.labelMode === 'count') text = String(i + 1).padStart(2, '0');
      else if (state.labelMode === 'name') text = CALLSIGNS[(t.id - 1) % CALLSIGNS.length];
      else text = (state.labelText || 'BLOB').toUpperCase();

      const r = this.blobRadius(t);
      const x = t.x * w;
      let y = t.y * h;
      if (state.labelPos === 'below') y += r + fs * 0.9;
      else if (state.labelPos === 'above') y -= r + fs * 0.9;
      else y += fs * 0.36;
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  }

  drawCaption(w, h) {
    const text = state.caption.trim();
    if (!text) return;
    const k = h / 1080;
    const fs = Math.max(9, state.captionSize * k);
    const ctx = this.ctx;
    let y;
    if (state.captionPos === 'top') y = h * 0.11;
    else if (state.captionPos === 'center') y = h * 0.52;
    else y = h * 0.895;

    ctx.save();
    ctx.font = `800 ${fs}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.shadowColor = 'rgba(0,0,0,.7)';
    ctx.shadowBlur = 14 * k;
    try { ctx.letterSpacing = `${Math.round(fs * 0.24)}px`; } catch { /* older browsers */ }
    ctx.fillText(text, w / 2, y);
    try { ctx.letterSpacing = '0px'; } catch { /* older browsers */ }
    ctx.restore();
  }

  drawRoi(w, h) {
    const roi = this.roiDrag || state.roi;
    if (!roi) return;
    const ctx = this.ctx;
    const k = h / 1080;
    const x = roi.x * w;
    const y = roi.y * h;
    const rw = roi.w * w;
    const rh = roi.h * h;
    const arm = Math.min(26 * k, rw / 3, rh / 3);

    ctx.save();
    ctx.fillStyle = 'rgba(200,255,77,.035)';
    ctx.fillRect(x, y, rw, rh);
    ctx.strokeStyle = 'rgba(200,255,77,.85)';
    ctx.lineWidth = Math.max(1, 1.5 * k);
    ctx.setLineDash(this.roiDrag ? [7 * k, 6 * k] : []);
    ctx.strokeRect(x, y, rw, rh);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y + arm); ctx.lineTo(x, y); ctx.lineTo(x + arm, y);
    ctx.moveTo(x + rw - arm, y); ctx.lineTo(x + rw, y); ctx.lineTo(x + rw, y + arm);
    ctx.moveTo(x + rw, y + rh - arm); ctx.lineTo(x + rw, y + rh); ctx.lineTo(x + rw - arm, y + rh);
    ctx.moveTo(x + arm, y + rh); ctx.lineTo(x, y + rh); ctx.lineTo(x, y + rh - arm);
    ctx.lineWidth = Math.max(1.5, 2.5 * k);
    ctx.stroke();

    const fs = Math.max(8, 10 * k);
    ctx.font = `700 ${fs}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(200,255,77,.95)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('ROI', x + 4 * k, y - 4 * k);
    ctx.restore();
  }

  drawIdle(w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.55);
    g.addColorStop(0, 'rgba(99,230,255,.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,255,77,.9)';
    ctx.font = `800 ${Math.round(h * 0.026)}px ui-monospace, monospace`;
    try { ctx.letterSpacing = `${Math.round(h * 0.006)}px`; } catch { /* noop */ }
    ctx.fillText('BLOBTRACK', w / 2, h / 2 - h * 0.02);
    ctx.fillStyle = 'rgba(160,172,190,.55)';
    ctx.font = `500 ${Math.round(h * 0.012)}px ui-monospace, monospace`;
    ctx.fillText('WAITING FOR SIGNAL', w / 2, h / 2 + h * 0.028);
    ctx.restore();
  }

  /* ---------------- frame ---------------- */

  draw() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);

    if (!this.isReady()) {
      this.tracks = [];
      this.drawIdle(w, h);
      this.fx.overlays(ctx, w, h, state, this.time, 1 / 60);
      return;
    }

    this.drawBackground(w, h);
    this.fx.post(ctx, w, h, state, this.time);

    const blobs = this.detect();
    this.updateTracks(blobs);

    this.drawBlobCutout();
    this.drawConnections();
    this.drawBlobs();
    this.drawLabels();
    this.drawCaption(w, h);
    this.fx.overlays(ctx, w, h, state, this.time, 1 / Math.max(24, this.fps));
    this.drawRoi(w, h);
  }
}

function hexA(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
