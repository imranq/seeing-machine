// Extraocular muscle biomechanics.
// Each muscle pulls from a fixed orbital pulley (or the trochlea / oblique origin) and wraps
// over the globe to its insertion. Its rotational moment is R·(axis) while wrapped, and
// ins × pull-direction once it unwraps — the classic Robinson (1975) string model with
// Demer's active pulleys. The brain's command is found by inverting the healthy model
// at the Listing's-law orientation; the eye itself is then simulated forward with the
// real (possibly paralysed) muscles, so palsies produce the right deviations on their own.
import * as THREE from 'three';
import { G, eyeCenter, RIGHT } from './anatomy.js';

const DEG = Math.PI / 180;
const K_PASSIVE = 10; // orbital stiffness (moment units per radian)
const VISCOSITY = 0.16;
const TONE = 0.3; // primary-position innervation (fraction of max)
const FLACCID = 0.12; // a paralysed muscle still has passive elastic tension
const LAMBDA = 6;

// Insertion on the limbus meridian: `dist` mm behind the limbus along the globe.
function recInsertion(u, v, dist) {
  const thL = Math.acos(G.limbusZ / G.R);
  const th = thL + dist / G.R;
  const s = Math.sin(th);
  return [u * s * G.R, v * s * G.R, Math.cos(th) * G.R];
}
function onGlobe(u, v, w) {
  const l = Math.hypot(u, v, w);
  return [(u / l) * G.R, (v / l) * G.R, (w / l) * G.R];
}

// (u nasal, v up, w forward) relative to the globe centre, mm
export const MUSCLE_DEFS = [
  { id: 'MR', name: 'Medial rectus', nerve: 'III', ins: recInsertion(1, 0, 5.5), pulley: [14.5, 0, -7], origin: [15.5, 2, -34], width: 10.3, action: 'adducts' },
  { id: 'LR', name: 'Lateral rectus', nerve: 'VI', ins: recInsertion(-1, 0, 6.9), pulley: [-14.5, 0, -8], origin: [10, 1.5, -34.5], width: 9.2, action: 'abducts' },
  { id: 'SR', name: 'Superior rectus', nerve: 'III', ins: recInsertion(0.05, 1, 7.7), pulley: [3, 14, -9], origin: [13, 5.5, -34], width: 10.6, action: 'elevates · intorts · adducts' },
  { id: 'IR', name: 'Inferior rectus', nerve: 'III', ins: recInsertion(0.05, -1, 6.5), pulley: [3, -14, -9], origin: [13, -1.5, -34], width: 9.8, action: 'depresses · extorts · adducts' },
  { id: 'SO', name: 'Superior oblique', nerve: 'IV', ins: onGlobe(-5, 8, -6), pulley: [15, 12, 5], origin: [15, 6, -33], width: 9.5, action: 'intorts · depresses · abducts', trochlea: true },
  { id: 'IO', name: 'Inferior oblique', nerve: 'III', ins: onGlobe(-8, -4, -7), pulley: [12.5, -13, 6], origin: [12.5, -13, 6], width: 9.4, action: 'extorts · elevates · abducts' },
];
export const NERVE_OF = { III: ['MR', 'SR', 'IR', 'IO'], IV: ['SO'], VI: ['LR'] };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

// rotation vector (axis·angle) of a quaternion
function rotVec(q, out) {
  const w = THREE.MathUtils.clamp(q.w, -1, 1);
  const s = Math.sqrt(Math.max(1 - w * w, 0));
  let ang = 2 * Math.acos(Math.abs(w));
  if (s < 1e-6) return out.set(0, 0, 0);
  const sign = w < 0 ? -1 : 1;
  return out.set((q.x / s) * sign * ang, (q.y / s) * sign * ang, (q.z / s) * sign * ang);
}

export class Oculomotor {
  constructor(side) {
    this.side = side;
    this.nasal = -side;
    this.center = eyeCenter(side);
    const n = this.nasal;
    this.muscles = MUSCLE_DEFS.map((d) => ({
      ...d,
      insL: new THREE.Vector3(d.ins[0] * n, d.ins[1], d.ins[2]),
      P: new THREE.Vector3(d.pulley[0] * n, d.pulley[1], d.pulley[2]),
      O: new THREE.Vector3(d.origin[0] * n, d.origin[1], d.origin[2]),
      f: TONE, // actual force (innervation) this frame
      cmd: TONE, // brain's command
      alive: true,
      m: new THREE.Vector3(),
      length: 0,
    }));
    this.q = new THREE.Quaternion();
    this.qDes = new THREE.Quaternion();
    this.omega = new THREE.Vector3();
    this.palsy = { III: false, IV: false, VI: false };
  }

  setPalsy(nerve, on) {
    this.palsy[nerve] = on;
    for (const m of this.muscles) m.alive = !this.palsy[m.nerve];
  }

  moment(m, q, out) {
    const ins = _a.copy(m.insL).applyQuaternion(q);
    const P = m.P;
    const Pl = P.length();
    const cosT = G.R / Pl;
    const cosA = ins.dot(P) / (G.R * Pl);
    if (cosA < cosT) {
      out.crossVectors(ins, P);
      const l = out.length();
      return l > 1e-9 ? out.multiplyScalar(G.R / l) : out.set(0, 0, 0);
    }
    const dir = _b.subVectors(P, ins).normalize();
    return out.crossVectors(ins, dir);
  }

  // Brain side: innervation that holds the eye at qDes (the "step") plus the extra force
  // needed to overcome orbital viscosity at velocity omegaDes (the saccadic "pulse").
  command(qDes, omegaDes) {
    const M = this.muscles.map((m) => this.moment(m, qDes, new THREE.Vector3()));
    const b = rotVec(qDes, _c).multiplyScalar(K_PASSIVE);
    if (omegaDes) b.addScaledVector(omegaDes, VISCOSITY);
    // min ||Σ f_i m_i − b||² + λ||f − tone||², 0 ≤ f ≤ 1  → projected Gauss–Seidel
    const A = [];
    const r = [];
    for (let i = 0; i < 6; i++) {
      A.push([]);
      for (let j = 0; j < 6; j++) A[i].push(M[i].dot(M[j]) + (i === j ? LAMBDA : 0));
      r.push(M[i].dot(b) + LAMBDA * TONE);
    }
    const f = this.muscles.map((m) => m.cmd);
    for (let it = 0; it < 60; it++) {
      for (let i = 0; i < 6; i++) {
        let s = r[i];
        for (let j = 0; j < 6; j++) if (j !== i) s -= A[i][j] * f[j];
        f[i] = THREE.MathUtils.clamp(s / A[i][i], 0, 1);
      }
    }
    this.muscles.forEach((m, i) => (m.cmd = f[i]));
  }

  // Plant: overdamped rotation under muscle + passive torques.
  step(dt) {
    const tau = _c.set(0, 0, 0);
    for (const m of this.muscles) {
      m.f = m.alive ? m.cmd : FLACCID;
      this.moment(m, this.q, m.m);
      tau.addScaledVector(m.m, m.f);
    }
    const rv = rotVec(this.q, _b);
    tau.addScaledVector(rv, -K_PASSIVE);
    this.omega.copy(tau).multiplyScalar(1 / VISCOSITY);
    const ang = this.omega.length() * dt;
    if (ang > 1e-9) {
      const dq = new THREE.Quaternion().setFromAxisAngle(_a.copy(this.omega).normalize(), ang);
      this.q.premultiply(dq).normalize();
    }
  }

  gaze(q = this.q, out = new THREE.Vector3()) {
    return out.set(0, 0, 1).applyQuaternion(q);
  }

  // torsion of q relative to the Listing's-law orientation with the same gaze (deg, + = extorsion)
  torsion(q = this.q) {
    const g = this.gaze(q, new THREE.Vector3());
    const ql = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), g);
    const upL = new THREE.Vector3(0, 1, 0).applyQuaternion(ql);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const ang = Math.atan2(new THREE.Vector3().crossVectors(upL, up).dot(g), upL.dot(up));
    // extorsion = top of the eye rotating away from the nose
    return (ang / DEG) * (this.side === RIGHT ? 1 : -1);
  }

  // polyline of the muscle path in eye-centred orbit coordinates
  path(m, q, out = []) {
    out.length = 0;
    const ins = new THREE.Vector3().copy(m.insL).applyQuaternion(q);
    const P = m.P;
    out.push(m.O.clone());
    if (m.trochlea) {
      out.push(m.O.clone().lerp(P, 0.5).add(new THREE.Vector3(0, 1.5, 0)));
      out.push(P.clone());
    } else if (m.id !== 'IO') {
      out.push(m.O.clone().lerp(P, 0.5));
      out.push(P.clone());
    }
    const Pl = P.length();
    const e1 = P.clone().normalize();
    const e2 = ins.clone().addScaledVector(e1, -ins.dot(e1));
    if (e2.lengthSq() < 1e-8) {
      out.push(ins);
      return out;
    }
    e2.normalize();
    const T = Math.acos(G.R / Pl);
    const Aang = Math.acos(THREE.MathUtils.clamp(ins.dot(e1) / G.R, -1, 1));
    if (Aang > T) {
      const n = Math.max(3, Math.ceil((Aang - T) / (6 * DEG)));
      for (let i = 0; i <= n; i++) {
        const a = T + ((Aang - T) * i) / n;
        out.push(e1.clone().multiplyScalar(Math.cos(a) * (G.R + 0.25)).addScaledVector(e2, Math.sin(a) * (G.R + 0.25)));
      }
    } else {
      out.push(ins);
    }
    return out;
  }
}

// ------------------------------------------------------------------ gaze controller
// Saccades follow the main sequence (duration ≈ 2.7·A + 23 ms, minimum-jerk profile);
// smooth pursuit tracks slow targets up to ~60°/s, with catch-up saccades beyond that.
const minJerk = (x) => x * x * x * (10 - 15 * x + 6 * x * x);

export class GazeController {
  constructor() {
    this.cmd = { R: new THREE.Vector3(0, 0, 1), L: new THREE.Vector3(0, 0, 1) };
    this.sacc = null;
    this.errTime = 0;
    this.latency = 0.14;
    this.onSaccade = null;
  }

  update(dt, desR, desL, now) {
    const err = Math.max(this.cmd.R.angleTo(desR), this.cmd.L.angleTo(desL)) / DEG;
    if (this.sacc) {
      const s = this.sacc;
      const x = Math.min((now - s.t0) / s.dur, 1);
      const k = minJerk(x);
      this.cmd.R.copy(s.r0).lerp(s.r1, k).normalize();
      this.cmd.L.copy(s.l0).lerp(s.l1, k).normalize();
      if (x >= 1) this.sacc = null;
      return;
    }
    if (err > 2.2) this.errTime += dt;
    else this.errTime = 0;
    if (this.errTime > this.latency) {
      this.errTime = 0;
      const amp = err;
      const dur = (2.7 * amp + 23) / 1000;
      this.sacc = { t0: now, dur, amp, r0: this.cmd.R.clone(), r1: desR.clone(), l0: this.cmd.L.clone(), l1: desL.clone() };
      this.onSaccade?.(amp, dur);
      return;
    }
    // pursuit + vergence: velocity-limited tracking
    const maxStep = 60 * DEG * dt;
    for (const [c, d] of [[this.cmd.R, desR], [this.cmd.L, desL]]) {
      const a = c.angleTo(d);
      if (a < 1e-6) continue;
      const stepA = Math.min(a * Math.min(1, dt * 9), maxStep);
      const axis = _a.crossVectors(c, d).normalize();
      c.applyAxisAngle(axis, stepA).normalize();
    }
  }
}

export function listingQuat(dir, out = new THREE.Quaternion()) {
  return out.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
}

export const TUNING = { K_PASSIVE, TONE };
