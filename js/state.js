/* Shared state, palettes and looks */
export const PALETTES = {
  neon: ['#c8ff4d', '#5ee7ff', '#ff7ad9', '#ffd166', '#9d8cff', '#4dffb8'],
  candy: ['#ff5c8a', '#ffb36b', '#ffe66d', '#8dff7a', '#6bd5ff', '#c08bff'],
  ice: ['#e6faff', '#9fe4ff', '#5cb8ff', '#3a86ff', '#7c5cff', '#b8f2e6'],
  thermal: ['#fff3b0', '#ffc46b', '#ff8c42', '#ff5e3a', '#e63946', '#ffd6a5'],
  sunset: ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff', '#ff8fab'],
  mono: ['#ffffff', '#d6dae2', '#a7afbf', '#7c8598', '#e8ebf2', '#b9c0cc'],
  spectrum: Array.from({ length: 7 }, (_, i) => `hsl(${i * 51} 100% 62%)`),
};

export const CALLSIGNS = [
  'NOVA', 'ECHO', 'FLUX', 'ORBIT', 'PULSE', 'DRIFT', 'HALO', 'VORTEX',
  'NEON', 'MOON', 'KITE', 'GLOW', 'WISP', 'ARC', 'ZERO', 'LUMA',
];

export const DEFAULT_STATE = {
  // source
  mirror: false,
  fit: 'cover',

  // tracking
  threshold: 128,
  invertMode: 'off',
  minSize: 14,
  maxBlobs: 24,
  smoothing: 45,
  detRes: 'medium',
  roi: null,

  // shapes
  shape: 'circle',
  blobSize: 100,
  uniform: true,
  stroke: 2,
  fill: false,
  fillOpacity: 14,
  color: '#c8ff4d',
  palette: 'neon',
  separateColors: true,
  blobInvert: 'off',
  glow: 14,
  dashed: false,
  dashLen: 8,
  dashGap: 7,

  // connections
  connection: 'nearest',
  density: 50,
  linkDistance: 35,
  linkColor: '#8fd8ff',
  linkUseBlobColors: false,
  linkWidth: 1.5,
  linkDashed: false,
  curve: true,
  connectPoint: 'center',

  // labels
  showLabels: true,
  labelMode: 'id',
  labelText: 'BLOB',
  labelPos: 'below',
  labelSize: 14,
  labelColor: '#ffffff',
  caption: '',
  captionPos: 'bottom',
  captionSize: 26,

  // effects
  effect: 'none',
  effectStrength: 55,
  invertStyle: 'negative',
  scanlines: false,
  grid: false,
  vignette: true,
  grain: 10,
  particles: false,
  frame: false,
  blink: false,

  // output
  aspect: '16:9',
  resolution: 1080,
  fps: 60,
  exportQuality: 'high',
  watermark: false,

  // audio
  audioLoop: true,
  musicVolume: 80,
  muted: false,
};

export const state = structuredClone(DEFAULT_STATE);

const SETTINGS_KEY = 'blobtrack.settings.v1';
const PRESET_KEY = 'blobtrack.presets.v1';

const PERSIST_KEYS = new Set(Object.keys(DEFAULT_STATE).filter(
  (k) => !['roi', 'aspect', 'resolution', 'fps', 'muted'].includes(k)
));
PERSIST_KEYS.add('aspect');
PERSIST_KEYS.add('resolution');
PERSIST_KEYS.add('fps');

let saveTimer = 0;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = {};
    for (const k of PERSIST_KEYS) data[k] = state[k];
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch { /* storage full / blocked */ }
  }, 350);
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    // Migrate the old "track dark blobs" checkbox to the new invert select.
    if (!data.invertMode && data.invertTrack === true) state.invertMode = 'luminance';
    for (const [k, v] of Object.entries(data)) {
      if (k in DEFAULT_STATE && k !== 'roi') state[k] = v;
    }
  } catch { /* ignore corrupt settings */ }
}

export function getPalette() {
  return PALETTES[state.palette] || PALETTES.neon;
}

export function saveCustomPresets(list) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function loadCustomPresets() {
  try {
    const list = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
    return Array.isArray(list) ? list.filter((p) => p && p.name && p.patch) : [];
  } catch { return []; }
}

export const PRESETS = [
  {
    id: 'neon',
    name: 'Neon Field',
    patch: {
      shape: 'circle', blobSize: 95, uniform: true, stroke: 2, fill: false, fillOpacity: 14, blobInvert: 'off', glow: 24,
      color: '#c8ff4d', palette: 'neon', separateColors: true, dashed: false,
      connection: 'nearest', density: 45, linkColor: '#bff7ff', curve: true, linkDashed: true,
      linkWidth: 1.25, linkUseBlobColors: false, showLabels: true, labelMode: 'id',
      labelPos: 'below', labelSize: 12, labelColor: '#ffffff',
      effect: 'none', effectStrength: 50, scanlines: false, grid: false, vignette: true,
      grain: 8, particles: true, frame: false, blink: false, caption: '', captionPos: 'bottom',
      captionSize: 26, watermark: false,
    },
  },
  {
    id: 'thermal',
    name: 'Thermal Scan',
    patch: {
      shape: 'target', blobSize: 110, uniform: false, stroke: 2, fill: false, blobInvert: 'off', glow: 12,
      color: '#ffcf9e', palette: 'thermal', separateColors: false, dashed: false,
      connection: 'constellation', density: 40, linkColor: '#ff8a4c', curve: false,
      linkDashed: false, linkWidth: 1, linkUseBlobColors: false,
      showLabels: false, labelMode: 'id', labelPos: 'below', labelSize: 12,
      effect: 'thermal', effectStrength: 62, scanlines: true, grid: false, vignette: true,
      grain: 16, particles: false, frame: false, blink: false, caption: '', watermark: false,
    },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    patch: {
      shape: 'bracket', blobSize: 120, uniform: false, stroke: 1.5, fill: false, blobInvert: 'off', glow: 6,
      color: '#8fd0ff', palette: 'ice', separateColors: false, dashed: false,
      connection: 'chain', density: 70, linkColor: '#3e7bb8', curve: false, linkDashed: true,
      linkWidth: 1, linkUseBlobColors: false, showLabels: true, labelMode: 'id',
      labelPos: 'above', labelSize: 11, labelColor: '#cbe9ff',
      effect: 'none', effectStrength: 50, scanlines: false, grid: true, vignette: true,
      grain: 6, particles: false, frame: false, blink: false,
      caption: 'FIG. 01 — MOTION MAP', captionPos: 'top', captionSize: 12, watermark: false,
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    patch: {
      shape: 'square', blobSize: 85, uniform: true, stroke: 1.5, fill: false, blobInvert: 'off', glow: 10,
      color: '#5dffa8', palette: 'mono', separateColors: false, dashed: false,
      connection: 'mesh', density: 30, linkDistance: 30, linkColor: '#2a7d52', curve: false,
      linkDashed: false, linkWidth: 1, linkUseBlobColors: false,
      showLabels: true, labelMode: 'id', labelPos: 'below', labelSize: 10,
      labelColor: '#9dffc7', effect: 'none', effectStrength: 50, scanlines: true, grid: true,
      vignette: true, grain: 24, particles: false, frame: false, blink: false,
      caption: 'TRACK // ACTIVE', captionPos: 'top', captionSize: 12, watermark: false,
    },
  },
  {
    id: 'rave',
    name: 'Rave',
    patch: {
      shape: 'hex', blobSize: 115, uniform: false, stroke: 2, fill: true, fillOpacity: 16, blobInvert: 'off',
      glow: 32, color: '#ff2e88', palette: 'spectrum', separateColors: true, dashed: false,
      connection: 'mesh', density: 38, linkDistance: 45, linkColor: '#ffffff',
      linkUseBlobColors: true, curve: true, linkDashed: true, linkWidth: 1.5,
      showLabels: false, labelMode: 'id', labelPos: 'below', labelSize: 12,
      effect: 'none', effectStrength: 50, scanlines: false, grid: false, vignette: true,
      grain: 6, particles: true, frame: false, blink: true, caption: 'RAVE', captionPos: 'bottom',
      captionSize: 20, watermark: false,
    },
  },
  {
    id: 'film',
    name: 'Film Study',
    patch: {
      shape: 'lframe', blobSize: 105, uniform: true, stroke: 1.5, fill: false, blobInvert: 'off', glow: 4,
      color: '#f4f0e6', palette: 'mono', separateColors: false, dashed: false,
      connection: 'off', density: 40, linkColor: '#f4f0e6', curve: true, linkDashed: false,
      linkWidth: 1, linkUseBlobColors: false, showLabels: true, labelMode: 'name',
      labelPos: 'below', labelSize: 11, labelColor: '#f4f0e6',
      effect: 'backdrop', effectStrength: 55, scanlines: false, grid: false, vignette: true,
      grain: 30, particles: false, frame: true, blink: false,
      caption: 'BLOBTRACK', captionPos: 'bottom', captionSize: 16, watermark: false,
    },
  },
];

export const VISUAL_KEYS = Object.keys(DEFAULT_STATE).filter(
  (k) => !['muted'].includes(k)
);
