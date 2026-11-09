/* UI wiring, source control, presets and transport */
import { state, PRESETS, PALETTES, DEFAULT_STATE, loadSettings, saveSettings, loadCustomPresets, saveCustomPresets } from './state.js';
import { Engine } from './engine.js';
import { AudioManager } from './audio.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad2 = (n) => String(n).padStart(2, '0');
const formatTime = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

loadSettings();

const canvas = $('#canvas');
const stage = $('#stage');
const stageCol = $('#stageCol');
const engine = new Engine(canvas);
const audio = new AudioManager();

const ui = {
  videoFile: $('#videoFile'),
  musicFile: $('#musicFile'),
  cameraRow: $('#cameraRow'),
  cameraSelect: $('#cameraSelect'),
  sourceMeta: $('#sourceMeta'),
  sourceDims: $('#sourceDims'),
  sourcePill: $('#sourcePill'),
  resPill: $('#resPill'),
  sideRes: $('#sideRes'),
  sideStatus: $('#sideStatus'),
  statusDot: $('#statusDot'),
  statFps: $('#statFps'),
  statBlobs: $('#statBlobs'),
  timeNow: $('#timeNow'),
  timeTotal: $('#timeTotal'),
  seek: $('#seek'),
  btnPlay: $('#btnPlay'),
  playIcon: $('#playIcon use'),
  btnLoop: $('#btnLoop'),
  speed: $('#speed'),
  btnMute: $('#btnMute'),
  muteIcon: $('#muteIcon use'),
  btnRecord: $('#btnRecord'),
  btnRecordLabel: $('#btnRecordLabel'),
  recPill: $('#recPill'),
  recLabel: $('#recLabel'),
  recTime: $('#recTime'),
  btnRecStop: $('#btnRecStop'),
  presetBar: $('#presetBar'),
  mobileLooks: $('#mobileLooks'),
  musicMeta: $('#musicMeta'),
  toneSelect: $('#toneSelect'),
  toneLevel: $('#toneLevel'),
  toneLevelOut: $('#toneLevelOut'),
  micToggle: $('#micToggle'),
  roiHint: $('#roiHint'),
  roiTip: $('#roiTip'),
  btnRoi: $('#btnRoi'),
  linkOptions: $('#linkOptions'),
  distanceRow: $('#distanceRow'),
  labelOptions: $('#labelOptions'),
  labelTextRow: $('#labelTextRow'),
  fillOpacityRow: $('#fillOpacityRow'),
  invertStyleRow: $('#invertStyleRow'),
  colorRow: $('#colorRow'),
  formatHint: $('#formatHint'),
  exportDlg: $('#exportDlg'),
  exportDuration: $('#exportDuration'),
  durationRow: $('#durationRow'),
  exportNote: $('#exportNote'),
  exSource: $('#exSource'),
  exSize: $('#exSize'),
  exFps: $('#exFps'),
  exFormat: $('#exFormat'),
  presetDlg: $('#presetDlg'),
  presetName: $('#presetName'),
  infoDlg: $('#infoDlg'),
  toasts: $('#toasts'),
  sheetBackdrop: $('#sheetBackdrop'),
};

let activeLookKey = null;
let applyingLook = false;
let customPresets = loadCustomPresets();
let loadedVideoName = '';
let cameraLabel = 'Camera';
let seeking = false;
let roiStart = null;
let dragDepth = 0;
let videoLoop = true;

const NUMERIC = new Set(['resolution', 'fps']);
const OUT_FMT = {
  threshold: (v) => String(Math.round(v)),
  minSize: (v) => `${Math.round(v)}%`,
  maxBlobs: (v) => String(Math.round(v)),
  smoothing: (v) => `${Math.round(v)}%`,
  blobSize: (v) => `${Math.round(v)}%`,
  stroke: (v) => `${Number(v).toFixed(1)}px`,
  glow: (v) => String(Math.round(v)),
  fillOpacity: (v) => `${Math.round(v)}%`,
  density: (v) => `${Math.round(v)}%`,
  linkDistance: (v) => `${Math.round(v)}%`,
  linkWidth: (v) => `${Number(v).toFixed(1)}px`,
  labelSize: (v) => `${Math.round(v)}px`,
  captionSize: (v) => `${Math.round(v)}px`,
  effectStrength: (v) => `${Math.round(v)}%`,
  grain: (v) => String(Math.round(v)),
  musicVolume: (v) => `${Math.round(v)}%`,
};

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast${type ? ` ${type}` : ''}`;
  node.textContent = message;
  ui.toasts.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  }, 3200);
}

function setStatus(text, mode = '') {
  ui.sideStatus.textContent = text;
  ui.statusDot.classList.toggle('busy', mode === 'busy');
  ui.statusDot.classList.toggle('error', mode === 'error');
}

function pickMime() {
  const candidates = [
    { type: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { type: 'video/mp4', ext: 'mp4' },
    { type: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { type: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { type: 'video/webm', ext: 'webm' },
  ];
  if (!window.MediaRecorder) return { type: '', ext: 'webm' };
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate.type)) return candidate;
    } catch { /* keep looking */ }
  }
  return { type: '', ext: 'webm' };
}

const MIME = pickMime();

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------------- controls ---------------- */

function readControl(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range') return Number(el.value);
  if (NUMERIC.has(el.dataset.bind)) return Number(el.value);
  return el.value;
}

function onControlEvent(event) {
  const el = event.target.closest('[data-bind]');
  if (!el) return;
  state[el.dataset.bind] = readControl(el);
  handleStateChange(el.dataset.bind);
  saveSettings();
}

function handleStateChange(key) {
  updateOutputs();
  updateConditionals();
  syncGroups();
  if (!applyingLook && activeLookKey) {
    activeLookKey = null;
    renderPresets();
  }

  if (key === 'aspect' || key === 'resolution') {
    const size = engine.resizeOutput();
    updateStageMetrics(size);
  }
  if (key === 'muted') audio.setMuted(state.muted);
  if (key === 'musicVolume') audio.setMusicVolume(state.musicVolume);
  if (key === 'audioLoop') audio.setMusicLoop(state.audioLoop);
}

function updateOutputs() {
  for (const output of $$('[data-out]')) {
    const key = output.dataset.out;
    const value = state[key];
    output.textContent = OUT_FMT[key] ? OUT_FMT[key](value) : String(value);
  }
}

function syncAllControls() {
  applyingLook = true;
  for (const el of $$('[data-bind]')) {
    const key = el.dataset.bind;
    if (!(key in state)) continue;
    if (el.type === 'checkbox') el.checked = Boolean(state[key]);
    else el.value = state[key];
  }
  applyingLook = false;
  updateOutputs();
  updateConditionals();
  syncGroups();
  updateStageMetrics();
  updatePlayIcon();
  updateMuteIcon();
}

function syncGroups() {
  for (const btn of $$('[data-value]')) {
    const group = btn.closest('[data-set]');
    if (!group) continue;
    const set = group.dataset.set;
    const active = set === 'source'
      ? engine.mode === btn.dataset.value
      : state[set] === btn.dataset.value;
    btn.classList.toggle('is-active', active);
  }
}

function updateConditionals() {
  ui.cameraRow.hidden = engine.mode !== 'camera';
  ui.linkOptions.hidden = state.connection === 'off';
  ui.distanceRow.hidden = state.connection !== 'mesh';
  ui.labelOptions.hidden = !state.showLabels;
  ui.labelTextRow.hidden = state.labelMode !== 'custom';
  ui.fillOpacityRow.hidden = !state.fill && state.blobInvert !== 'cutout';
  ui.invertStyleRow.hidden = state.effect !== 'invert';
  ui.roiHint.hidden = !state.roi && !engine.roiMode;
}

function updateStageMetrics(size) {
  const s = size || { w: canvas.width, h: canvas.height };
  stageCol.style.setProperty('--stage-ratio', String(s.w / s.h));
  ui.resPill.textContent = `${s.w}×${s.h}`;
  ui.sideRes.textContent = `${s.w}×${s.h}`;
}

/* ---------------- looks ---------------- */

function renderPresets() {
  for (const bar of [ui.presetBar, ui.mobileLooks]) {
    if (!bar) continue;
    bar.replaceChildren();

    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.preset = preset.id;
      btn.textContent = preset.name;
      if (activeLookKey === `p:${preset.id}`) btn.classList.add('is-active');
      bar.append(btn);
    }

    for (const preset of customPresets) {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.custom = preset.id;
      if (activeLookKey === `c:${preset.id}`) btn.classList.add('is-active');
      btn.append(document.createTextNode(preset.name));
      const del = document.createElement('span');
      del.className = 'chip-del';
      del.dataset.del = preset.id;
      del.textContent = '×';
      del.title = 'Delete preset';
      btn.append(del);
      bar.append(btn);
    }

    const save = document.createElement('button');
    save.className = 'chip add';
    save.dataset.add = '1';
    save.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 3.5h11l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M8 3.5v5h7v-5"/></svg>';
    save.append(document.createTextNode('Save'));
    bar.append(save);

    const random = document.createElement('button');
    random.className = 'chip';
    random.dataset.random = '1';
    random.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 7h3.2c4.8 0 6.8 10 11.6 10H21"/><path d="m18 13.8 3 3.2-3 3.2"/><path d="M3 17h3.2c1.8 0 3.2-1.4 4.6-3.1"/><path d="M13.2 9.7C14.3 8.1 15.5 7 17.8 7H21"/><path d="m18 3.8 3 3.2-3 3.2"/></svg>';
    random.append(document.createTextNode('Random'));
    bar.append(random);
  }
}

function applyLook(patch, lookKey = null, name = '') {
  const oldAspect = state.aspect;
  const oldRes = state.resolution;
  Object.assign(state, patch);
  applyingLook = true;
  if (state.aspect !== oldAspect || state.resolution !== oldRes) engine.resizeOutput();
  syncAllControls();
  applyingLook = false;
  activeLookKey = lookKey;
  renderPresets();
  updateStageMetrics();
  saveSettings();
  if (name) toast(`Look applied — ${name}`);
}

function randomizeLook() {
  const shapeList = ['circle', 'square', 'diamond', 'hex', 'star', 'target', 'cross', 'xframe', 'bracket', 'lframe', 'dot', 'ring'];
  const effectList = ['none', 'none', 'blur', 'pixelate', 'dither', 'thermal', 'xray', 'edge', 'water', 'glitch', 'glow', 'invert', 'backdrop', 'zoom'];
  const linkList = ['off', 'nearest', 'chain', 'mesh', 'constellation'];
  const paletteKeys = Object.keys(PALETTES);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const pickPalette = pick(paletteKeys);
  const solidColors = ['#c8ff4d', '#63e6ff', '#ff7ad9', '#ffd166', '#9d8cff', '#ff8c42', '#ffffff', '#4dffb8'];
  const color = pick(solidColors);
  const captions = ['', '', '', 'BLOBTRACK', 'MOTION STUDY', 'NO SIGNAL', 'TRACKING', 'SYNTHETIC FIELD'];

  const patch = {
    shape: pick(shapeList),
    palette: pickPalette,
    color,
    separateColors: Math.random() < 0.65,
    glow: Math.round(Math.random() * 38),
    stroke: 0.5 + Math.round(Math.random() * 6) * 0.5,
    blobSize: 60 + Math.round(Math.random() * 110),
    uniform: Math.random() < 0.5,
    fill: Math.random() < 0.35,
    fillOpacity: 8 + Math.round(Math.random() * 25),
    blobInvert: pick(['off', 'off', 'off', 'off', 'negative', 'luminance', 'red', 'green', 'blue', 'saturation', 'hue', 'cutout']),
    dashed: Math.random() < 0.3,
    linkDashed: Math.random() < 0.4,
    connection: pick(linkList),
    density: 20 + Math.round(Math.random() * 60),
    linkDistance: 20 + Math.round(Math.random() * 60),
    linkUseBlobColors: Math.random() < 0.5,
    curve: Math.random() < 0.65,
    effect: pick(effectList),
    invertStyle: pick(['negative', 'luminance', 'red', 'green', 'blue', 'saturation', 'hue']),
    effectStrength: 30 + Math.round(Math.random() * 60),
    scanlines: Math.random() < 0.35,
    grid: Math.random() < 0.3,
    vignette: Math.random() < 0.8,
    grain: Math.round(Math.random() * 28),
    particles: Math.random() < 0.45,
    frame: Math.random() < 0.3,
    blink: Math.random() < 0.18,
    showLabels: Math.random() < 0.6,
    labelMode: pick(['id', 'count', 'name']),
    labelPos: pick(['below', 'above', 'center']),
    labelSize: 9 + Math.round(Math.random() * 10),
    caption: pick(captions),
    captionPos: pick(['top', 'center', 'bottom']),
    captionSize: 12 + Math.round(Math.random() * 28),
  };
  applyLook(patch, null, 'Randomized');
}

/* ---------------- source ---------------- */

function updateSourceUI() {
  const dims = engine.sourceDims();
  if (engine.mode === 'demo') {
    ui.sourceMeta.textContent = 'Built-in motion field';
    ui.sourceDims.textContent = dims ? `${dims[0]}×${dims[1]}` : '';
    ui.sourcePill.textContent = 'DEMO';
  } else if (engine.mode === 'camera') {
    ui.sourceMeta.textContent = cameraLabel || 'Camera';
    ui.sourceDims.textContent = dims ? `${dims[0]}×${dims[1]}` : '';
    ui.sourcePill.textContent = 'LIVE';
  } else {
    ui.sourceMeta.textContent = loadedVideoName || 'Video file';
    ui.sourceDims.textContent = dims ? `${dims[0]}×${dims[1]}` : '';
    ui.sourcePill.textContent = 'FILE';
  }
  ui.sourcePill.classList.toggle('live', engine.mode !== 'video');
  ui.cameraRow.hidden = engine.mode !== 'camera';
  ui.btnPlay.disabled = engine.mode === 'camera';
  ui.seek.disabled = engine.mode !== 'video';
  ui.btnLoop.disabled = engine.mode !== 'video';
  ui.speed.disabled = engine.mode === 'camera';
  syncGroups();
  updateConditionals();
  updateTransport();
}

function handleSourceChange(mode) {
  if (mode === 'demo') {
    loadedVideoName = '';
    setStatus('Demo field running');
  } else if (mode === 'camera') {
    setStatus('Camera live');
  } else {
    setStatus('Video loaded');
  }
  updateSourceUI();
  updatePlayIcon();
}

function switchSource(mode) {
  if (mode === 'demo') {
    engine.useDemo();
    toast('Built-in motion field');
    return;
  }
  if (mode === 'camera') {
    startCameraFlow();
    return;
  }
  if (mode === 'video') {
    ui.videoFile.click();
  }
}

async function startCameraFlow(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Camera access needs HTTPS or localhost.', 'error');
    syncGroups();
    return;
  }
  setStatus('Requesting camera…', 'busy');
  try {
    await engine.startCamera(deviceId);
    ui.cameraRow.hidden = false;
    await refreshCameras();
    cameraLabel = ui.cameraSelect.selectedOptions[0]?.textContent || 'Camera';
    updateSourceUI();
    setStatus('Camera live');
  } catch (error) {
    const message = error?.name === 'NotAllowedError'
      ? 'Camera permission was denied.'
      : `Camera unavailable${error?.message ? `: ${error.message}` : '.'}`;
    toast(message, 'error');
    setStatus('Camera unavailable', 'error');
    syncGroups();
  }
}

async function refreshCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  ui.cameraSelect.replaceChildren();
  cameras.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;
    ui.cameraSelect.append(option);
  });
  const track = engine.cameraStream?.getVideoTracks()[0];
  const activeId = track?.getSettings?.().deviceId;
  if (activeId) ui.cameraSelect.value = activeId;
}

async function handleVideoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) {
    toast('That is not a video file.', 'error');
    return;
  }
  setStatus('Loading video…', 'busy');
  try { await audio.ensure(); } catch { /* audio can fail independently */ }
  audio.attachVideo(engine.video);
  try {
    const info = await engine.useVideoFile(file);
    loadedVideoName = file.name;
    updateSourceUI();
    if (engine.video.paused) toast('Video loaded — press play to start.', '');
    else toast(`Video loaded · ${formatTime(info.duration)}`);
    setStatus('Video loaded');
  } catch (error) {
    toast(error.message || 'Could not load that video.', 'error');
    setStatus('Video error', 'error');
    syncGroups();
    updateSourceUI();
  }
}

async function handleMusicFile(file) {
  if (!file) return;
  if (!file.type.startsWith('audio/')) {
    toast('That is not an audio file.', 'error');
    return;
  }
  try {
    await audio.loadMusic(file);
    ui.musicMeta.textContent = file.name;
    toast('Music loaded');
  } catch (error) {
    toast(`Could not load audio${error?.message ? `: ${error.message}` : '.'}`, 'error');
  }
}

/* ---------------- transport ---------------- */

function updatePlayIcon() {
  const playing = engine.isPlaying();
  ui.playIcon.setAttribute('href', playing ? '#i-pause' : '#i-play');
  ui.btnPlay.title = playing ? 'Pause (Space)' : 'Play (Space)';
}

function updateMuteIcon() {
  ui.muteIcon.setAttribute('href', state.muted ? '#i-mute' : '#i-volume');
  ui.btnMute.classList.toggle('is-active', state.muted);
}

function setSeekFill(pct) {
  ui.seek.style.setProperty('--seek', `${Math.max(0, Math.min(100, pct))}%`);
}

function updateTransport() {
  if (engine.mode === 'video') {
    const duration = engine.video.duration;
    const current = engine.video.currentTime;
    ui.timeTotal.textContent = formatTime(duration);
    if (!seeking) {
      ui.timeNow.textContent = formatTime(current);
      const frac = Number.isFinite(duration) && duration > 0 ? current / duration : 0;
      ui.seek.value = String(Math.round(frac * 1000));
      setSeekFill(frac * 100);
    }
  } else if (engine.mode === 'demo') {
    ui.timeNow.textContent = formatTime(engine.demo.t);
    ui.timeTotal.textContent = 'LIVE';
    ui.seek.value = '0';
    setSeekFill(0);
  } else {
    ui.timeNow.textContent = 'LIVE';
    ui.timeTotal.textContent = 'LIVE';
    ui.seek.value = '0';
    setSeekFill(0);
  }
  updatePlayIcon();
}

function togglePlay() {
  if (engine.mode === 'camera') return;
  engine.togglePlay();
  updatePlayIcon();
}

function toggleMute() {
  state.muted = !state.muted;
  audio.setMuted(state.muted);
  updateMuteIcon();
  saveSettings();
}

function toggleZen() {
  document.body.classList.toggle('zen');
  if (document.body.classList.contains('zen')) closePanel();
}

/* ---------------- ROI ---------------- */

function enterRoiMode() {
  engine.setRoiMode(true);
  stage.classList.add('roi-mode');
  ui.roiTip.hidden = false;
  ui.btnRoi.classList.add('is-active');
  updateConditionals();
  closePanel();
  toast('Drag a rectangle on the stage to set the tracking region.');
}

function exitRoiMode() {
  engine.setRoiMode(false);
  engine.setRoiDrag(null);
  stage.classList.remove('roi-mode');
  ui.roiTip.hidden = true;
  ui.btnRoi.classList.remove('is-active');
  updateConditionals();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

function normRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/* ---------------- mobile sheet ---------------- */

function openPanel() {
  document.body.classList.add('panel-open');
  ui.sheetBackdrop.hidden = false;
}

function closePanel() {
  document.body.classList.remove('panel-open');
  ui.sheetBackdrop.hidden = true;
}

/* ---------------- stats ---------------- */

function handleStats(stats) {
  ui.statFps.textContent = String(stats.fps);
  ui.statBlobs.textContent = String(stats.blobs);
  updateTransport();
  ui.sourcePill.classList.toggle('live', stats.mode !== 'video');
}

/* ---------------- events ---------------- */

function bindEvents() {
  document.addEventListener('input', onControlEvent);
  document.addEventListener('change', onControlEvent);

  document.addEventListener('click', (event) => {
    const group = event.target.closest('[data-set]');
    if (!group) return;
    const set = group.dataset.set;
    if (set === 'source') {
      const choice = event.target.closest('[data-value]');
      if (choice) switchSource(choice.dataset.value);
      return;
    }
    const btn = event.target.closest('[data-value]');
    if (!btn || !(set in state)) return;
    state[set] = btn.dataset.value;
    handleStateChange(set);
    saveSettings();
  });

  const onPresetClick = (event) => {
    const del = event.target.closest('[data-del]');
    if (del) {
      event.stopPropagation();
      customPresets = customPresets.filter((p) => p.id !== del.dataset.del);
      saveCustomPresets(customPresets);
      if (activeLookKey === `c:${del.dataset.del}`) activeLookKey = null;
      renderPresets();
      toast('Preset deleted');
      return;
    }
    if (event.target.closest('[data-add]')) {
      openPresetDialog();
      return;
    }
    if (event.target.closest('[data-random]')) {
      randomizeLook();
      return;
    }
    const builtin = event.target.closest('[data-preset]');
    if (builtin) {
      const preset = PRESETS.find((p) => p.id === builtin.dataset.preset);
      if (preset) applyLook(preset.patch, `p:${preset.id}`, preset.name);
      return;
    }
    const custom = event.target.closest('[data-custom]');
    if (custom) {
      const preset = customPresets.find((p) => p.id === custom.dataset.custom);
      if (preset) applyLook(preset.patch, `c:${preset.id}`, preset.name);
    }
  };
  ui.presetBar.addEventListener('click', onPresetClick);
  ui.mobileLooks.addEventListener('click', onPresetClick);

  $('#btnUploadVideo').addEventListener('click', () => ui.videoFile.click());
  ui.videoFile.addEventListener('change', () => {
    const file = ui.videoFile.files?.[0];
    if (file) handleVideoFile(file);
    ui.videoFile.value = '';
  });
  $('#btnMusic').addEventListener('click', () => ui.musicFile.click());
  ui.musicFile.addEventListener('change', () => {
    const file = ui.musicFile.files?.[0];
    if (file) handleMusicFile(file);
    ui.musicFile.value = '';
  });
  $('#btnClearMusic').addEventListener('click', () => {
    audio.clearMusic();
    ui.musicMeta.textContent = 'No music track loaded';
    toast('Music cleared');
  });

  ui.cameraSelect.addEventListener('change', () => {
    cameraLabel = ui.cameraSelect.selectedOptions[0]?.textContent || 'Camera';
    startCameraFlow(ui.cameraSelect.value);
  });

  document.querySelector('[data-bind="mirror"]').addEventListener('change', () => {
    if (engine.mode === 'camera') toast(state.mirror ? 'Camera mirrored' : 'Camera unmirrored');
  });

  ui.btnPlay.addEventListener('click', togglePlay);
  ui.btnLoop.addEventListener('click', () => {
    videoLoop = !videoLoop;
    engine.setLoop(videoLoop);
    ui.btnLoop.classList.toggle('is-active', videoLoop);
    toast(videoLoop ? 'Loop on' : 'Loop off');
  });
  ui.speed.addEventListener('change', () => engine.setSpeed(Number(ui.speed.value)));
  ui.btnMute.addEventListener('click', toggleMute);

  ui.seek.addEventListener('pointerdown', () => { seeking = true; });
  ui.seek.addEventListener('input', () => {
    const frac = Number(ui.seek.value) / 1000;
    setSeekFill(frac * 100);
    if (engine.mode === 'video') {
      engine.seek(frac);
      ui.timeNow.textContent = formatTime(engine.video.currentTime);
    }
  });
  const endSeek = () => { seeking = false; };
  ui.seek.addEventListener('pointerup', endSeek);
  ui.seek.addEventListener('change', endSeek);
  ui.seek.addEventListener('pointercancel', endSeek);

  ui.btnRoi.addEventListener('click', () => {
    if (engine.roiMode) exitRoiMode();
    else enterRoiMode();
  });
  $('#btnClearRoi').addEventListener('click', () => {
    state.roi = null;
    saveSettings();
    updateConditionals();
    toast('Tracking region cleared');
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (!engine.roiMode) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    roiStart = canvasPoint(event);
    engine.setRoiDrag({ ...roiStart, w: 0, h: 0 });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!roiStart) return;
    engine.setRoiDrag(normRect(roiStart, canvasPoint(event)));
  });
  const finishRoi = (event) => {
    if (!roiStart) return;
    const rect = normRect(roiStart, canvasPoint(event));
    roiStart = null;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
    if (rect.w > 0.01 && rect.h > 0.01) {
      state.roi = rect;
      saveSettings();
      exitRoiMode();
      toast('Tracking region set');
    } else {
      engine.setRoiDrag(null);
    }
    updateConditionals();
  };
  canvas.addEventListener('pointerup', finishRoi);
  canvas.addEventListener('pointercancel', (event) => {
    roiStart = null;
    engine.setRoiDrag(null);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
    updateConditionals();
  });

  $('#btnZen').addEventListener('click', toggleZen);
  document.querySelector('#btnSnapshot').addEventListener('click', snapshot);
  document.querySelector('#btnSnapshot2').addEventListener('click', snapshot);
  ui.btnRecord.addEventListener('click', toggleRecording);
  ui.btnRecStop.addEventListener('click', stopRecording);
  document.querySelector('#btnExport').addEventListener('click', openExport);
  document.querySelector('#btnExport2').addEventListener('click', openExport);
  $('#btnInfo').addEventListener('click', () => ui.infoDlg.showModal());

  ui.toneSelect.addEventListener('change', async () => {
    try {
      await audio.setTone(ui.toneSelect.value);
      if (ui.toneSelect.value !== 'off') toast('Ambient synth on');
    } catch (error) {
      toast(`Synth unavailable${error?.message ? `: ${error.message}` : '.'}`, 'error');
    }
  });
  ui.toneLevel.addEventListener('input', () => {
    ui.toneLevelOut.textContent = ui.toneLevel.value;
    audio.setToneLevel(Number(ui.toneLevel.value));
  });
  ui.micToggle.addEventListener('change', async () => {
    try {
      await audio.setMic(ui.micToggle.checked);
      if (ui.micToggle.checked) toast('Microphone armed for recording');
    } catch {
      ui.micToggle.checked = false;
      toast('Microphone permission was denied.', 'error');
    }
  });

  $('#btnMobilePanel').addEventListener('click', openPanel);
  $('#btnClosePanel').addEventListener('click', closePanel);
  ui.sheetBackdrop.addEventListener('click', closePanel);

  stage.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth++;
    stage.classList.add('dragging');
  });
  stage.addEventListener('dragover', (event) => event.preventDefault());
  stage.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) stage.classList.remove('dragging');
  });
  stage.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    stage.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type.startsWith('video/')) handleVideoFile(file);
    else if (file.type.startsWith('audio/')) handleMusicFile(file);
    else toast('Drop a video or audio file.', 'error');
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, select, textarea, dialog')) return;
    if (document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (key === ' ') {
      event.preventDefault();
      togglePlay();
    } else if (key === 'r') {
      toggleRecording();
    } else if (key === 's') {
      snapshot();
    } else if (key === 'h') {
      toggleZen();
    } else if (key === 'm') {
      toggleMute();
    } else if (key === 'escape') {
      if (engine.roiMode) exitRoiMode();
      else if (document.body.classList.contains('zen')) document.body.classList.remove('zen');
      else closePanel();
    }
  });

  window.addEventListener('resize', () => updateTransport());
  engine.video.addEventListener('ended', updatePlayIcon);
  engine.video.addEventListener('play', updatePlayIcon);
  engine.video.addEventListener('pause', updatePlayIcon);
  window.addEventListener('pagehide', () => {
    engine.stopCameraStream();
    audio.setMic(false);
  });
}

/* ---------------- recording, export and dialogs ---------------- */

const rec = {
  mr: null,
  chunks: [],
  stream: null,
  active: false,
  stopping: false,
  startedAt: 0,
  timer: 0,
  autoStop: 0,
  endedHandler: null,
  wasLoop: null,
  mode: 'manual',
  mime: { ...MIME },
};

function bitrate() {
  const mult = { standard: 1, high: 1.35, max: 1.9 }[state.exportQuality] || 1;
  const raw = canvas.width * canvas.height * (Number(state.fps) || 60) * 0.09 * mult;
  return Math.min(55000000, Math.max(3000000, Math.round(raw)));
}

function updateRecClock() {
  const seconds = (performance.now() - rec.startedAt) / 1000;
  ui.recTime.textContent = formatTime(seconds);
}

function showRecUI() {
  ui.recPill.hidden = false;
  ui.recLabel.textContent = rec.mode === 'export' ? 'EXPORT' : 'REC';
  ui.recTime.textContent = '00:00';
  ui.btnRecStop.disabled = false;
  ui.btnRecord.classList.add('is-rec');
  ui.btnRecordLabel.textContent = 'Stop';
}

function cleanupRecording() {
  clearInterval(rec.timer);
  clearTimeout(rec.autoStop);
  rec.timer = 0;
  rec.autoStop = 0;
  if (rec.endedHandler) {
    engine.video.removeEventListener('ended', rec.endedHandler);
    rec.endedHandler = null;
  }
  if (rec.wasLoop !== null) {
    engine.setLoop(rec.wasLoop);
    rec.wasLoop = null;
  }
  if (rec.stream) {
    rec.stream.getTracks().forEach((track) => {
      if (track.kind === 'video') track.stop();
    });
  }
  rec.stream = null;
  rec.chunks = [];
  rec.mr = null;
  rec.active = false;
  rec.stopping = false;
  ui.recPill.hidden = true;
  ui.recLabel.textContent = 'REC';
  ui.btnRecStop.disabled = false;
  ui.btnRecord.classList.remove('is-rec');
  ui.btnRecordLabel.textContent = 'Record';
  updatePlayIcon();
}

async function startRecording(kind = 'manual', duration = null) {
  if (rec.active || rec.stopping) return;
  if (!engine.isReady()) {
    toast('No ready source to record yet.', 'error');
    return;
  }
  if (!window.MediaRecorder) {
    toast('MediaRecorder is not supported in this browser.', 'error');
    return;
  }

  setStatus('Starting recorder…', 'busy');
  try { await audio.ensure(); } catch { /* video can still record without audio */ }
  if (engine.mode === 'video') audio.attachVideo(engine.video);

  try {
    rec.stream = canvas.captureStream(Number(state.fps) || 60);
  } catch (error) {
    toast(`Could not capture the canvas${error?.message ? `: ${error.message}` : '.'}`, 'error');
    setStatus('Recorder unavailable', 'error');
    return;
  }

  const audioStream = audio.getRecordStream();
  if (audioStream) {
    for (const track of audioStream.getAudioTracks()) rec.stream.addTrack(track);
  }

  const mime = { ...MIME };
  const options = { videoBitsPerSecond: bitrate() };
  if (mime.type) options.mimeType = mime.type;
  options.audioBitsPerSecond = 192000;

  let mr;
  try {
    mr = new MediaRecorder(rec.stream, options);
  } catch {
    try { mr = new MediaRecorder(rec.stream); } catch (error) {
      cleanupRecording();
      toast(`Recording could not start${error?.message ? `: ${error.message}` : '.'}`, 'error');
      setStatus('Recorder unavailable', 'error');
      return;
    }
  }

  const actual = mr.mimeType || mime.type || '';
  rec.mime = /mp4/i.test(actual) ? { type: actual || 'video/mp4', ext: 'mp4' } : { type: actual || 'video/webm', ext: 'webm' };
  rec.mr = mr;
  rec.chunks = [];
  rec.mode = kind;
  rec.active = true;
  rec.stopping = false;
  rec.startedAt = performance.now();

  mr.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size) rec.chunks.push(event.data);
  });
  mr.addEventListener('stop', () => {
    const blob = new Blob(rec.chunks, { type: rec.mime.type || 'video/webm' });
    const ext = rec.mime.ext;
    cleanupRecording();
    if (!blob.size) {
      toast('Recording came out empty.', 'error');
      setStatus('Recorder empty', 'error');
      return;
    }
    const name = `blobtrack-${stamp()}.${ext}`;
    downloadBlob(blob, name);
    toast(`Saved ${name} · ${(blob.size / 1048576).toFixed(1)} MB`);
    setStatus('Export saved');
  });
  mr.addEventListener('error', () => {
    cleanupRecording();
    toast('The recorder hit an error.', 'error');
    setStatus('Recorder error', 'error');
  });

  try {
    mr.start(300);
  } catch (error) {
    cleanupRecording();
    toast(`Recording could not start${error?.message ? `: ${error.message}` : '.'}`, 'error');
    return;
  }

  showRecUI();
  rec.timer = setInterval(updateRecClock, 200);

  if (kind === 'export') {
    if (engine.mode === 'video') {
      rec.wasLoop = engine.video.loop;
      engine.setLoop(false);
      engine.video.currentTime = 0;
      engine.video.playbackRate = engine.speed;
      engine.play();
      rec.endedHandler = () => {
        if (rec.active) stopRecording();
      };
      engine.video.addEventListener('ended', rec.endedHandler);
    } else {
      if (engine.mode === 'demo') {
        engine.demo.t = 0;
        engine.drawDemo();
        engine.play();
      }
      const seconds = duration || 10;
      rec.autoStop = setTimeout(() => stopRecording(), seconds * 1000);
    }
  }

  setStatus(kind === 'export' ? 'Exporting…' : 'Recording…', 'busy');
  toast(kind === 'export' ? 'Export recording started…' : 'Recording started — press R to stop.');
}

function stopRecording() {
  if (!rec.mr || !rec.active) return;
  rec.active = false;
  rec.stopping = true;
  clearInterval(rec.timer);
  clearTimeout(rec.autoStop);
  ui.recLabel.textContent = 'SAVING';
  ui.btnRecStop.disabled = true;
  ui.btnRecord.classList.remove('is-rec');
  ui.btnRecordLabel.textContent = 'Record';
  try {
    rec.mr.stop();
  } catch {
    cleanupRecording();
  }
}

function toggleRecording() {
  if (rec.active) stopRecording();
  else startRecording('manual');
}

function snapshot() {
  if (!engine.isReady()) {
    toast('No frame to save yet.', 'error');
    return;
  }
  canvas.toBlob((blob) => {
    if (!blob) {
      toast('Could not capture this frame.', 'error');
      return;
    }
    const name = `blobtrack-frame-${stamp()}.png`;
    downloadBlob(blob, name);
    toast(`Saved ${name}`);
  }, 'image/png');
}

function updateExportInfo() {
  ui.exSource.textContent = engine.mode === 'demo'
    ? 'Built-in field'
    : engine.mode === 'camera'
      ? (cameraLabel || 'Camera')
      : (loadedVideoName || 'Video');
  ui.exSize.textContent = `${canvas.width} × ${canvas.height}`;
  ui.exFps.textContent = `${state.fps} fps`;
  ui.exFormat.textContent = MIME.ext.toUpperCase();
  ui.durationRow.hidden = engine.mode === 'video';

  const start = $('#btnStartExport');
  start.disabled = !window.MediaRecorder || !engine.isReady();

  if (!window.MediaRecorder) {
    ui.exportNote.textContent = 'MediaRecorder is not available. Try Chrome, Edge or Firefox.';
  } else if (engine.mode === 'video') {
    ui.exportNote.textContent = `Records the full clip from the start (${formatTime(engine.video.duration)}) with its audio.`;
  } else if (engine.mode === 'camera') {
    ui.exportNote.textContent = 'Records live video until the timer ends. Audio includes music, synth and mic.';
  } else {
    ui.exportNote.textContent = 'Records a fixed-length clip of the built-in field from the beginning.';
  }

  ui.formatHint.textContent = MIME.ext === 'mp4'
    ? 'Exports MP4 with AAC audio where supported.'
    : 'Exports WebM (VP9/VP8 + Opus) in this browser.';
}

function openExport() {
  updateExportInfo();
  ui.exportDlg.showModal();
}

function openPresetDialog() {
  ui.presetName.value = '';
  ui.presetDlg.showModal();
  setTimeout(() => ui.presetName.focus(), 60);
}

function savePresetFromDialog(event) {
  event.preventDefault();
  if (event.submitter && event.submitter.value === 'cancel') {
    ui.presetDlg.close();
    return;
  }
  const name = ui.presetName.value.trim() || `Look ${customPresets.length + 1}`;
  const patch = {};
  for (const key of Object.keys(DEFAULT_STATE)) {
    if (key === 'roi' || key === 'muted') continue;
    patch[key] = state[key];
  }
  const id = `c${Date.now()}`;
  customPresets.push({ id, name, patch });
  saveCustomPresets(customPresets);
  activeLookKey = `c:${id}`;
  renderPresets();
  ui.presetDlg.close();
  toast(`Preset saved — ${name}`);
}

function init() {
  bindEvents();
  renderPresets();
  syncAllControls();
  updateSourceUI();
  updateStageMetrics();
  updateMuteIcon();
  updateExportInfo();
  ui.btnLoop.classList.add('is-active');

  engine.onSource = handleSourceChange;
  engine.onStats = handleStats;
  engine.start();
  engine.drawDemo();

  $('#btnStartExport').addEventListener('click', (event) => {
    event.preventDefault();
    if (!window.MediaRecorder) {
      toast('MediaRecorder is not supported in this browser.', 'error');
      return;
    }
    const duration = Number(ui.exportDuration.value) || 10;
    ui.exportDlg.close();
    startRecording('export', engine.mode === 'video' ? null : duration);
  });

  $('#presetForm').addEventListener('submit', savePresetFromDialog);

  for (const dialog of $$('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  if (!window.MediaRecorder) {
    ui.formatHint.textContent = 'MediaRecorder is not available — try Chrome, Edge or Firefox.';
  }
  setStatus('Engine ready');
}

init();

