/* Shape geometry for tracked blobs */
const FILLABLE = new Set(['circle', 'ring', 'square', 'diamond', 'hex', 'star']);

function polygon(ctx, points) {
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function hexPath(ctx, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  polygon(ctx, pts);
}

function starPath(ctx, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.44 : r;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  polygon(ctx, pts);
}

export function traceShape(ctx, shape, r) {
  ctx.beginPath();
  switch (shape) {
    case 'square': {
      const s = r * 0.79;
      ctx.rect(-s, -s, s * 2, s * 2);
      break;
    }
    case 'diamond':
      polygon(ctx, [[0, -r * 1.05], [r, 0], [0, r * 1.05], [-r, 0]]);
      break;
    case 'hex':
      hexPath(ctx, r);
      break;
    case 'star':
      starPath(ctx, r);
      break;
    case 'target':
      ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2);
      break;
    case 'cross': {
      const t = Math.max(2, r * 0.3);
      ctx.moveTo(-t / 2, -r);
      ctx.lineTo(t / 2, -r);
      ctx.lineTo(t / 2, -t / 2);
      ctx.lineTo(r, -t / 2);
      ctx.lineTo(r, t / 2);
      ctx.lineTo(t / 2, t / 2);
      ctx.lineTo(t / 2, r);
      ctx.lineTo(-t / 2, r);
      ctx.lineTo(-t / 2, t / 2);
      ctx.lineTo(-r, t / 2);
      ctx.lineTo(-r, -t / 2);
      ctx.lineTo(-t / 2, -t / 2);
      ctx.closePath();
      break;
    }
    case 'xframe':
      ctx.moveTo(-r, -r);
      ctx.lineTo(r, r);
      ctx.moveTo(r, -r);
      ctx.lineTo(-r, r);
      break;
    case 'bracket': {
      const s = r * 0.98;
      const a = r * 0.38;
      ctx.moveTo(-s, -s + a); ctx.lineTo(-s, -s); ctx.lineTo(-s + a, -s);
      ctx.moveTo(s - a, -s); ctx.lineTo(s, -s); ctx.lineTo(s, -s + a);
      ctx.moveTo(s, s - a); ctx.lineTo(s, s); ctx.lineTo(s - a, s);
      ctx.moveTo(-s + a, s); ctx.lineTo(-s, s); ctx.lineTo(-s, s - a);
      break;
    }
    case 'lframe': {
      const s = r;
      const a = r * 0.55;
      ctx.moveTo(-s, -s + a); ctx.lineTo(-s, -s); ctx.lineTo(-s + a, -s);
      ctx.moveTo(s, s - a); ctx.lineTo(s, s); ctx.lineTo(s - a, s);
      break;
    }
    case 'dot':
      ctx.arc(0, 0, Math.max(2, r * 0.26), 0, Math.PI * 2);
      break;
    case 'ring':
    case 'circle':
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
  }
}

/**
 * Draw one blob at the current transform origin.
 * Expects ctx already translated to the blob center.
 */
export function drawBlob(ctx, state, r, scale) {
  const shape = state.shape;
  const canFill = FILLABLE.has(shape) && shape !== 'ring';
  const lineWidth = Math.max(0.5, state.stroke * scale);
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(state.dashed ? [state.dashLen * scale, state.dashGap * scale] : []);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  traceShape(ctx, shape, r);

  if (shape === 'dot') {
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(1, lineWidth * 0.75);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(4, r * 0.72), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  if (state.fill && canFill) {
    ctx.globalAlpha = Math.max(0, Math.min(1, state.fillOpacity / 100));
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (lineWidth > 0) ctx.stroke();

  if (shape === 'target') {
    const t = r * 0.34;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.25); ctx.lineTo(0, -r * 0.72);
    ctx.moveTo(0, r * 0.72); ctx.lineTo(0, r * 1.25);
    ctx.moveTo(-r * 1.25, 0); ctx.lineTo(-r * 0.72, 0);
    ctx.moveTo(r * 0.72, 0); ctx.lineTo(r * 1.25, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, t, 0, Math.PI * 2);
    ctx.fill();
  }

  if (shape === 'ring') {
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(0.5, lineWidth * 0.6);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
