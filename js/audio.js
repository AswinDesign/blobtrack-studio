/* Audio graph: preview, recorder bus, music, synth tones and mic */
import { state } from './state.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.previewGain = null;
    this.recordGain = null;
    this.recDest = null;

    this.videoEl = null;
    this.videoSource = null;
    this.videoGain = null;

    this.music = null; // { el, source, gain, url, name }
    this.tone = { kind: 'off', bus: null, nodes: [], timer: 0, nextTime: 0, step: 0, level: 0.35 };

    this.mic = { stream: null, source: null, gain: null };
  }

  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio is not available in this browser.');
      this.ctx = new AC();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 22;
      this.compressor.ratio.value = 3;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.25;

      this.previewGain = this.ctx.createGain();
      this.previewGain.gain.value = state.muted ? 0 : 1;

      this.recordGain = this.ctx.createGain();
      this.recordGain.gain.value = 1;

      this.master.connect(this.compressor);
      this.compressor.connect(this.previewGain);
      this.previewGain.connect(this.ctx.destination);
      this.compressor.connect(this.recordGain);

      this.recDest = this.ctx.createMediaStreamDestination();
      this.recordGain.connect(this.recDest);
    }
    try { await this.ctx.resume(); } catch { /* needs a gesture */ }
    return this.ctx;
  }

  setMuted(muted) {
    if (!this.previewGain) return;
    const t = this.ctx.currentTime;
    this.previewGain.gain.cancelScheduledValues(t);
    this.previewGain.gain.setTargetAtTime(muted ? 0 : 1, t, 0.03);
  }

  attachVideo(el) {
    if (!el || this.videoSource === null) {
      if (!this.ctx) return;
      try {
        this.videoSource = this.ctx.createMediaElementSource(el);
        this.videoGain = this.ctx.createGain();
        this.videoGain.gain.value = 0.9;
        this.videoSource.connect(this.videoGain);
        this.videoGain.connect(this.master);
        el.volume = 1;
        el.muted = false;
      } catch {
        this.videoSource = null;
      }
    }
  }

  async loadMusic(file) {
    await this.ensure();
    this.clearMusic();
    const url = URL.createObjectURL(file);
    const el = new Audio(url);
    el.loop = !!state.audioLoop;
    el.preload = 'auto';
    const source = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    gain.gain.value = (state.musicVolume / 100) * 0.9;
    source.connect(gain);
    gain.connect(this.master);
    this.music = { el, source, gain, url, name: file.name };
    try { await el.play(); } catch { /* user can press play in transport */ }
    return this.music;
  }

  clearMusic() {
    if (!this.music) return;
    try { this.music.el.pause(); } catch { /* noop */ }
    try { this.music.source.disconnect(); } catch { /* noop */ }
    try { this.music.gain.disconnect(); } catch { /* noop */ }
    URL.revokeObjectURL(this.music.url);
    this.music = null;
  }

  setMusicVolume(v) {
    if (!this.music) return;
    const t = this.ctx.currentTime;
    this.music.gain.gain.setTargetAtTime((v / 100) * 0.9, t, 0.03);
  }

  setMusicLoop(loop) {
    if (this.music) this.music.el.loop = !!loop;
  }

  /* ---- built-in synth ---- */
  async setTone(kind) {
    this.stopTone();
    this.tone.kind = kind;
    if (!kind || kind === 'off') return;
    await this.ensure();

    const bus = this.ctx.createGain();
    bus.gain.value = this.tone.level * 0.7;
    bus.connect(this.master);
    this.tone.bus = bus;

    if (kind === 'drone') this.startDrone();
    else {
      this.tone.nextTime = this.ctx.currentTime + 0.06;
      this.tone.step = 0;
      this.scheduleTone();
      this.tone.timer = setInterval(() => this.scheduleTone(), 60);
    }
  }

  scheduleTone() {
    if (!this.ctx || !this.tone.bus) return;
    const horizon = this.ctx.currentTime + 0.28;
    const kind = this.tone.kind;
    let guard = 0;
    while (this.tone.nextTime < horizon && guard++ < 24) {
      if (kind === 'pulse') {
        this.kick(this.tone.nextTime);
        this.tone.nextTime += 0.6;
      } else if (kind === 'arp') {
        const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
        const semi = scale[this.tone.step % scale.length] + (this.tone.step % 16 < 8 ? 0 : -12);
        const freq = 220 * Math.pow(2, semi / 12);
        this.pluck(this.tone.nextTime, freq);
        this.tone.step++;
        this.tone.nextTime += 0.19;
      } else {
        break;
      }
    }
  }

  kick(t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.16);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(gain);
    gain.connect(this.tone.bus);
    osc.start(t);
    osc.stop(t + 0.46);
  }

  pluck(t, freq) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.tone.bus);
    osc.start(t);
    osc.stop(t + 0.38);
  }

  startDrone() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 4;
    filter.connect(this.tone.bus);

    const freqs = [55, 55.35, 82.5];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      gain.gain.value = 0.055;
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      this.tone.nodes.push({ osc, gain, filter: null });
    }

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.055;
    lfoGain.gain.value = 170;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    this.tone.nodes.push({ osc: lfo, gain: lfoGain, filter, lfo: true });
  }

  stopTone() {
    clearInterval(this.tone.timer);
    this.tone.timer = 0;
    for (const n of this.tone.nodes) {
      try { n.osc.stop(); } catch { /* already stopped */ }
      try { n.osc.disconnect(); } catch { /* noop */ }
      try { n.gain.disconnect(); } catch { /* noop */ }
    }
    this.tone.nodes = [];
    if (this.tone.bus) {
      try { this.tone.bus.disconnect(); } catch { /* noop */ }
    }
    this.tone.bus = null;
    this.tone.kind = 'off';
  }

  setToneLevel(v) {
    this.tone.level = Math.max(0, Math.min(1, v / 100));
    if (this.tone.bus) {
      const t = this.ctx.currentTime;
      this.tone.bus.gain.setTargetAtTime(this.tone.level * 0.7, t, 0.03);
    }
  }

  async setMic(on) {
    if (!on) {
      if (this.mic.stream) this.mic.stream.getTracks().forEach((t) => t.stop());
      if (this.mic.source) { try { this.mic.source.disconnect(); } catch { /* noop */ } }
      this.mic = { stream: null, source: null, gain: null };
      return false;
    }
    await this.ensure();
    if (this.mic.stream) return true;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const source = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = 0.9;
    source.connect(gain);
    gain.connect(this.recDest); // recorder only — avoids feedback
    this.mic = { stream, source, gain };
    return true;
  }

  getRecordStream() {
    if (!this.recDest) return null;
    return this.recDest.stream;
  }
}
