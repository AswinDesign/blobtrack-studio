/* Color conversion and blob invert helpers */

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3) * 255,
    hue2rgb(p, q, h) * 255,
    hue2rgb(p, q, h - 1 / 3) * 255,
  ];
}

let parseCtx = null;
const colorCache = new Map();

function parseCssColor(css) {
  if (!parseCtx) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    parseCtx = c.getContext('2d', { willReadFrequently: true });
  }
  parseCtx.clearRect(0, 0, 1, 1);
  parseCtx.fillStyle = '#000000';
  parseCtx.fillStyle = css;
  parseCtx.fillRect(0, 0, 1, 1);
  const d = parseCtx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

/**
 * Return an inverted version of a CSS color. Mirrors the visual effect styles
 * so the blobs can be inverted independently of the background.
 */
export function invertColor(css, mode) {
  if (!mode || mode === 'off' || mode === 'cutout') return css;
  const key = `${mode}|${css}`;
  const cached = colorCache.get(key);
  if (cached) return cached;

  const [r, g, b] = parseCssColor(css);
  let nr = r;
  let ng = g;
  let nb = b;

  if (mode === 'negative') {
    nr = 255 - r; ng = 255 - g; nb = 255 - b;
  } else if (mode === 'luminance') {
    nr = ng = nb = 255 - (r * 0.299 + g * 0.587 + b * 0.114);
  } else if (mode === 'red') {
    nr = 255 - r;
  } else if (mode === 'green') {
    ng = 255 - g;
  } else if (mode === 'blue') {
    nb = 255 - b;
  } else if (mode === 'hue' || mode === 'saturation') {
    const [hue, sat, light] = rgbToHsl(r, g, b);
    const nextHue = mode === 'hue' ? (hue + 0.5) % 1 : hue;
    const nextSat = mode === 'saturation' ? 1 - sat : sat;
    [nr, ng, nb] = hslToRgb(nextHue, nextSat, light);
  }

  const out = `rgb(${Math.round(nr)} ${Math.round(ng)} ${Math.round(nb)})`;
  if (colorCache.size > 512) colorCache.clear();
  colorCache.set(key, out);
  return out;
}
