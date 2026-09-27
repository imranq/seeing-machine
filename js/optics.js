// Meridional ray tracing through a Le Grand–style schematic eye.
// Coordinates: h = height from the optical axis (mm), t = depth behind the corneal vertex (mm).
import { G, IRIS_Z, lensShape } from './anatomy.js';

const N_CORNEA = 1.376;
const N_AQ = 1.336;
const N_VIT = 1.336;
let N_LENS = 1.42; // tuned at start-up so a 24 mm eye is emmetropic
const DN_ACCOM = 0.012; // equivalent-index rise of the accommodated lens
const IRIS_T = G.apex - IRIS_Z;
export const SPECTACLE_T = -12; // 12 mm vertex distance

function surfaces(A) {
  const L = lensShape(A);
  const nl = N_LENS + DN_ACCOM * A;
  return [
    // conic constants (after Navarro 1985, cornea Q tuned) stand in for the gradient-index lens and keep spherical aberration realistic
    { t: 0, R: 7.8, Q: -0.5, n: N_CORNEA },
    { t: 0.55, R: 6.5, Q: 0, n: N_AQ },
    { t: G.apex - L.zf, R: L.Rf, Q: -3.13, n: nl, rEq: L.rEq },
    { t: G.apex - L.zb, R: -L.Rb, Q: -1, n: N_VIT, rEq: L.rEq },
  ];
}

// retina: sphere of radius 11 about the rotation centre, stretched behind it by k
function hitRetina(p, d, axial) {
  const k = (axial - G.apex) / G.retinaR;
  // convert to eye-local (x=h, z) with posterior stretch removed
  const zc = G.apex; // t → z = apex − t
  // parametric: z(s) = apex − (p.t + s d.t); scale z<0 by 1/k (posterior hemisphere)
  const ox = p.h, oz = (zc - p.t) / k, dx = d.h, dz = -d.t / k;
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - G.retinaR * G.retinaR;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = (-b + Math.sqrt(disc)) / (2 * a);
  return { h: p.h + s * d.h, t: p.t + s * d.t };
}

// conic sag: t = S.t + c h² / (1 + sqrt(1 − (1+Q) c² h²)); Newton on the ray parameter
function sag(S, h) {
  const c = 1 / S.R;
  const q = 1 - (1 + S.Q) * c * c * h * h;
  if (q < 0) return null;
  return (c * h * h) / (1 + Math.sqrt(q));
}
function hitConic(p, d, S) {
  let s = (S.t - p.t) / d.t;
  for (let i = 0; i < 30; i++) {
    const h = p.h + s * d.h;
    const z = sag(S, h);
    if (z === null) return null;
    const f = p.t + s * d.t - (S.t + z);
    const e = 1e-4;
    const z2 = sag(S, h + e);
    if (z2 === null) return null;
    const dz = (z2 - z) / e;
    const df = d.t - dz * d.h;
    const ds = f / df;
    s -= ds;
    if (Math.abs(ds) < 1e-9) break;
  }
  const h = p.h + s * d.h;
  const z0 = sag(S, h), z1 = sag(S, h + 1e-4);
  if (z0 === null || z1 === null) return null;
  const slope = (z1 - z0) / 1e-4; // dt/dh of the surface
  const l = Math.hypot(1, slope);
  return { p: { h, t: S.t + z0 }, n: { h: -slope / l, t: 1 / l } };
}

function refract(d, nrm, n1, n2) {
  let nh = nrm.h, nt = nrm.t;
  let cosi = -(d.h * nh + d.t * nt);
  if (cosi < 0) {
    nh = -nh;
    nt = -nt;
    cosi = -cosi;
  }
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const f = eta * cosi - Math.sqrt(k);
  const h = eta * d.h + f * nh;
  const t = eta * d.t + f * nt;
  const l = Math.hypot(h, t);
  return { h: h / l, t: t / l };
}

// Trace one ray. Returns { pts:[{h,t}], blocked, retina:{h,t}|null, axisT }
export function traceRay(start, dir, state) {
  const { accom, pupil, axial, spec } = state;
  let p = { ...start };
  let d = { ...dir };
  const pts = [{ ...p }];
  // spectacle lens (thin lens in air)
  if (spec && p.t < SPECTACLE_T) {
    const s = (SPECTACLE_T - p.t) / d.t;
    p = { h: p.h + s * d.h, t: SPECTACLE_T };
    pts.push({ ...p });
    const slope = d.h / d.t - (p.h * spec) / 1000;
    const l = Math.hypot(slope, 1);
    d = { h: slope / l, t: 1 / l };
  }
  let n1 = 1;
  const surf = surfaces(accom);
  for (let i = 0; i < surf.length; i++) {
    const S = surf[i];
    // iris stop sits between the posterior cornea and the lens
    if (i === 2) {
      const s = (IRIS_T - p.t) / d.t;
      const hi = p.h + s * d.h;
      if (Math.abs(hi) > pupil / 2) {
        pts.push({ h: hi, t: IRIS_T });
        return { pts, blocked: true, retina: null };
      }
    }
    const hit = hitConic(p, d, S);
    if (!hit) return { pts, blocked: true, retina: null };
    p = hit.p;
    if (S.rEq && Math.abs(p.h) > S.rEq) return { pts: [...pts, p], blocked: true, retina: null };
    pts.push({ ...p });
    const nrm = hit.n;
    const nd = refract(d, nrm, n1, S.n);
    if (!nd) return { pts, blocked: true, retina: null };
    d = nd;
    n1 = S.n;
  }
  const r = hitRetina(p, d, axial);
  if (r) pts.push(r);
  const axisT = Math.abs(d.h) > 1e-9 ? p.t - (p.h / d.h) * d.t : Infinity;
  return { pts, blocked: false, retina: r, axisT };
}

// paraxial focus for an object at vergence V (dioptres at the cornea / spectacle plane)
function focusT(V, accom, spec = 0) {
  const h0 = 0.05;
  const startT = spec ? SPECTACLE_T - 1 : -1;
  // ray from the axial object point, reaching height h0 at the start plane
  const slope = (-h0 * V) / 1000;
  const l = Math.hypot(slope, 1);
  const res = traceRay({ h: h0 - slope * 0, t: startT }, { h: slope / l, t: 1 / l }, { accom, pupil: 12, axial: 24, spec });
  return res.axisT;
}

function retinaT(axial) {
  return axial;
}

// object vergence that is in focus on the retina for lens state A
export function focusedVergence(A, axial, spec = 0) {
  let lo = -40, hi = 40;
  const target = retinaT(axial);
  const f = (V) => focusT(V, A, spec) - target;
  const flo = f(lo);
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// tune the lens index so the relaxed 24 mm eye focuses at infinity
(function calibrate() {
  let lo = 1.38, hi = 1.46;
  for (let i = 0; i < 40; i++) {
    N_LENS = (lo + hi) / 2;
    const ft = focusT(0, 0);
    if (ft > 24) lo = N_LENS;
    else hi = N_LENS;
  }
})();

// accommodation (D) produced by lens state A
export function accomDioptres(A, axial) {
  return focusedVergence(0, axial) - focusedVergence(A, axial);
}

// Hofstetter's average amplitude of accommodation by age
export const amplitudeForAge = (age) => Math.max(0.6, 18.5 - 0.3 * age);

const A_MAX_LIMIT = 1.25;
export function lensStateForDioptres(D, axial) {
  let lo = 0, hi = A_MAX_LIMIT;
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2;
    if (accomDioptres(mid, axial) < D) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function refractiveError(axial) {
  return focusedVergence(0, axial); // dioptres at the cornea; negative = myopia
}
export const spectacleFor = (rxCornea) => rxCornea / (1 + 0.012 * rxCornea);

// Full optical state for UI + drawing.
// objDist in mm (Infinity allowed); age in years.
export function solveOptics({ objDist, age, axial, pupil, correct }) {
  const rx = refractiveError(axial);
  const spec = correct ? spectacleFor(rx) : 0;
  const vObj = Number.isFinite(objDist) ? -1000 / objDist : 0;
  // the eye accommodates as much as needed, up to its amplitude
  const amp = amplitudeForAge(age);
  const Amax = lensStateForDioptres(amp, axial);
  const f = (A) => focusT(vObj, A, spec) - retinaT(axial);
  let A;
  if (f(0) <= 0) A = 0; // already focused behind or at retina? (myope near object → no accommodation needed)
  else if (f(Amax) > 0) A = Amax;
  else {
    let lo = 0, hi = Amax;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid;
      else hi = mid;
    }
    A = (lo + hi) / 2;
  }
  // A myope looking at a near object focuses in front of the retina with A = 0 only if f(0) < 0.
  const state = { accom: A, pupil, axial, spec };
  const blur = blurDiameter(objDist, state);
  const used = accomDioptres(A, axial);
  const powerD = 1336 / Math.max(focusT(0, A) - 1.6, 1);
  return { A, Amax, amp, used, rx, spec, blur, blurArcmin: (blur / 16.7) * 3437.75, powerD, state };
}

function objectRays(objDist, fieldDeg, state, n = 15) {
  const rays = [];
  const rp = state.pupil / 2;
  const reach = rp * 1.2 + 0.5;
  const tan = Math.tan((fieldDeg * Math.PI) / 180);
  const finite = Number.isFinite(objDist);
  const Ht = finite ? -objDist : -1e7;
  const H = finite ? objDist * tan : 1e7 * tan;
  for (let i = 0; i < n; i++) {
    const y = -reach + (2 * reach * i) / (n - 1);
    // aim at height y on the corneal plane (off-axis rays aim around the chief ray)
    const aim = { h: y, t: 0 };
    let dh = aim.h - H, dt = aim.t - Ht;
    const l = Math.hypot(dh, dt);
    dh /= l;
    dt /= l;
    // start the drawn ray where it enters the scene
    const startT = finite ? Math.max(Ht, -140) : -140;
    const s = (startT - aim.t) / dt;
    const start = finite && Ht > -140 ? { h: H, t: Ht } : { h: aim.h + s * dh, t: startT };
    rays.push(traceRay(start, { h: dh, t: dt }, state));
  }
  return rays;
}

// RMS spot diameter on the retina, each ray weighted by the pupil annulus it samples
export function blurDiameter(objDist, state) {
  const rays = objectRays(objDist, 0, state, 41).filter((r) => !r.blocked && r.retina);
  if (rays.length < 2) return 0;
  let wSum = 0, mean = 0;
  const ws = rays.map((r) => Math.abs(r.pts[1] ? r.pts[1].h : 0) + 1e-3);
  rays.forEach((r, i) => { wSum += ws[i]; mean += ws[i] * r.retina.h; });
  mean /= wSum;
  let v = 0;
  rays.forEach((r, i) => (v += ws[i] * (r.retina.h - mean) ** 2));
  return 2 * Math.sqrt(v / wSum);
}

export function rayBundles(objDist, state, offAxis) {
  const out = [{ kind: 'axial', rays: objectRays(objDist, 0, state, 13) }];
  if (offAxis) out.push({ kind: 'field', rays: objectRays(objDist, 9, state, 9) });
  return out;
}
