// 2D instrument read-outs drawn on canvases.
import { RIGHT, LEFT } from './anatomy.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function fitCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}

// ------------------------------------------------------------------ visual field chart
export function drawField(canvas, grid, cells, stim, seen, eyeCol) {
  const { g, w, h } = fitCanvas(canvas);
  const { N, R } = grid;
  const size = Math.min(w, h) - 4;
  const cx = w / 2, cy = h / 2;
  const k = size / (2 * R);
  g.clearRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.arc(cx, cy, R * k, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#0a0d12';
  g.fillRect(0, 0, w, h);
  const cell = (2 * R * k) / (N - 1) + 0.6;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = cells[j * N + i];
      if (!v) continue;
      const x = cx + (-R + (i * 2 * R) / (N - 1)) * k;
      const y = cy - (R - (j * 2 * R) / (N - 1)) * k;
      g.fillStyle = v === 1 ? 'rgba(190,210,230,0.26)' : v === 2 ? 'rgba(255,70,70,0.12)' : '#000';
      if (v === 2) {
        g.fillStyle = '#050608';
      }
      g.fillRect(x - cell / 2, y - cell / 2, cell, cell);
    }
  }
  // lost area outline tint
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  for (const r of [10, 30, 50]) {
    g.beginPath();
    g.arc(cx, cy, r * k, 0, Math.PI * 2);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(cx - R * k, cy);
  g.lineTo(cx + R * k, cy);
  g.moveTo(cx, cy - R * k);
  g.lineTo(cx, cy + R * k);
  g.stroke();
  g.restore();
  g.strokeStyle = eyeCol;
  g.globalAlpha = 0.55;
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(cx, cy, R * k, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
  // fixation
  g.fillStyle = '#fff';
  g.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  if (stim && stim.mode === 'probe') {
    const x = cx + stim.fx * k, y = cy - stim.fy * k;
    g.beginPath();
    g.arc(x, y, Math.max(3, stim.r * k), 0, Math.PI * 2);
    g.fillStyle = seen ? 'rgba(255,226,150,0.95)' : 'rgba(255,226,150,0.15)';
    g.fill();
    g.strokeStyle = seen ? '#fff3c8' : 'rgba(255,90,90,0.9)';
    g.lineWidth = 1.5;
    g.stroke();
    if (!seen) {
      g.beginPath();
      g.moveTo(x - 5, y - 5);
      g.lineTo(x + 5, y + 5);
      g.moveTo(x + 5, y - 5);
      g.lineTo(x - 5, y + 5);
      g.stroke();
    }
  }
  return { cx, cy, k };
}

// ------------------------------------------------------------------ red-glass diplopia view
// Each eye's image of the target is placed where the brain thinks that eye's line of sight
// points (it trusts the command it sent). A misaligned eye therefore produces a ghost.
export function drawDiplopia(canvas, images, fixEye) {
  const { g, w, h } = fitCanvas(canvas);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#07090c';
  g.fillRect(0, 0, w, h);
  const k = Math.min(w, h) / 44; // px per degree (±22°)
  const cx = w / 2, cy = h / 2;
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  for (let d = -20; d <= 20; d += 5) {
    g.beginPath();
    g.moveTo(cx + d * k, 0);
    g.lineTo(cx + d * k, h);
    g.moveTo(0, cy + d * k);
    g.lineTo(w, cy + d * k);
    g.stroke();
  }
  g.globalCompositeOperation = 'lighter';
  for (const im of images) {
    const x = cx + im.dx * k, y = cy - im.dy * k;
    g.save();
    g.translate(x, y);
    g.rotate((-im.tilt * Math.PI) / 180);
    g.strokeStyle = im.color;
    g.fillStyle = im.color;
    g.shadowColor = im.color;
    g.shadowBlur = 12;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-9 * k * 0.5 - 18, 0);
    g.lineTo(9 * k * 0.5 + 18, 0);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 7, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.globalCompositeOperation = 'source-over';
  g.font = '500 10px "IBM Plex Mono", monospace';
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillText(`fixing eye: ${fixEye === RIGHT ? 'right' : 'left'}`, 8, h - 8);
  const sep = images.length === 2 ? Math.hypot(images[0].dx - images[1].dx, images[0].dy - images[1].dy) : 0;
  const tilt = images.length === 2 ? Math.abs(images[0].tilt - images[1].tilt) : 0;
  return { sep, tilt };
}

// ------------------------------------------------------------------ position traces
export class Traces {
  constructor(len = 360) {
    this.len = len;
    this.data = [];
  }
  push(sample) {
    this.data.push(sample);
    if (this.data.length > this.len) this.data.shift();
  }
  draw(canvas) {
    const { g, w, h } = fitCanvas(canvas);
    g.clearRect(0, 0, w, h);
    const half = h / 2;
    const lanes = [
      { key: 'az', label: 'horizontal', y0: half / 2 },
      { key: 'el', label: 'vertical', y0: half + half / 2 },
    ];
    const k = (half / 2 - 6) / 45;
    g.font = '500 9px "IBM Plex Mono", monospace';
    for (const L of lanes) {
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.beginPath();
      g.moveTo(0, L.y0);
      g.lineTo(w, L.y0);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillText(L.label, 6, L.y0 - half / 2 + 12);
      const series = [
        ['t', 'rgba(255,230,170,0.55)', 1],
        ['R', css('--eye-r'), 1.6],
        ['L', css('--eye-l'), 1.6],
      ];
      for (const [who, col, lw] of series) {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        this.data.forEach((d, i) => {
          const x = (i / (this.len - 1)) * w;
          const y = L.y0 - d[who][L.key] * k;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.stroke();
      }
    }
  }
}

export function drawMainSequence(canvas, pts) {
  const { g, w, h } = fitCanvas(canvas);
  g.clearRect(0, 0, w, h);
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const X = (a) => pad.l + (a / 50) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - (v / 700) * (h - pad.t - pad.b);
  g.font = '500 9px "IBM Plex Mono", monospace';
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  for (const a of [0, 10, 20, 30, 40, 50]) {
    g.beginPath();
    g.moveTo(X(a), pad.t);
    g.lineTo(X(a), h - pad.b);
    g.stroke();
    g.fillText(`${a}°`, X(a) - 6, h - 8);
  }
  for (const v of [0, 200, 400, 600]) {
    g.beginPath();
    g.moveTo(pad.l, Y(v));
    g.lineTo(w - pad.r, Y(v));
    g.stroke();
    g.fillText(`${v}`, 4, Y(v) + 3);
  }
  // Bahill et al. 1975 fit: Vpk = 500·(1 − e^(−A/14))
  g.strokeStyle = 'rgba(255,230,170,0.6)';
  g.setLineDash([3, 4]);
  g.beginPath();
  for (let a = 0; a <= 50; a += 1) {
    const v = 500 * (1 - Math.exp(-a / 14));
    a ? g.lineTo(X(a), Y(v)) : g.moveTo(X(a), Y(v));
  }
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = css('--eye-r');
  for (const p of pts) {
    g.beginPath();
    g.arc(X(p.a), Y(p.v), 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillText('peak velocity °/s vs amplitude', pad.l + 4, pad.t + 8);
}

// ------------------------------------------------------------------ retinal image
const ROWS = [
  { l: 'E', mar: 5 },
  { l: 'F P', mar: 2.5 },
  { l: 'T O Z', mar: 1.6 },
  { l: 'L P E D', mar: 1.0 },
  { l: 'P E C F D', mar: 0.75 },
];
export function drawRetinalImage(canvas, blurArcmin, lensTint) {
  const { g, w, h } = fitCanvas(canvas);
  const pxPerArcmin = h / 86;
  g.clearRect(0, 0, w, h);
  const off = document.createElement('canvas');
  off.width = Math.round(w * 2);
  off.height = Math.round(h * 2);
  const o = off.getContext('2d');
  o.scale(2, 2);
  o.fillStyle = '#f3efe6';
  o.fillRect(0, 0, w, h);
  o.fillStyle = '#121212';
  o.textAlign = 'center';
  let y = 8;
  const labels = [];
  for (const r of ROWS) {
    const size = r.mar * 5 * pxPerArcmin;
    y += size + 6;
    o.font = `600 ${size}px "IBM Plex Mono", monospace`;
    o.fillText(r.l, w / 2, y);
    labels.push([y, `20/${Math.round(r.mar * 20)}`]);
  }
  const sigma = (blurArcmin * pxPerArcmin) / 2.6;
  g.save();
  g.filter = sigma > 0.25 ? `blur(${sigma.toFixed(2)}px)` : 'none';
  g.drawImage(off, 0, 0, w, h);
  g.restore();
  if (lensTint > 0.02) {
    g.fillStyle = `rgba(190,140,40,${lensTint * 0.35})`;
    g.fillRect(0, 0, w, h);
  }
  g.font = '500 9px "IBM Plex Mono", monospace';
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.textAlign = 'left';
  for (const [yy, t] of labels) g.fillText(t, 6, yy);
}
