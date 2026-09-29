// The retinogeniculocortical pathway.
//
// • Inside the eye, axons follow the Jansonius et al. (2009) nerve-fibre-bundle model:
//   φ(φ0, r) = φ0 + b(φ0)·(r − r0)^c(φ0), arcing around the fovea to the optic disc.
// • Nasal-retina fibres (temporal visual field) cross at the chiasm; temporal fibres don't.
// • Each tract feeds the LGN (contralateral eye → layers 1, 4, 6; ipsilateral → 2, 3, 5).
// • Radiations carrying the upper visual field loop forward through the temporal lobe
//   (Meyer's loop); the lower field runs back through the parietal lobe.
// • V1 is a log-polar map (Schwartz 1977): the central 10° take ~60 % of the surface,
//   the upper field lies below the calcarine sulcus.
//
// Lesions are spheres in space (or a patch of V1). Whatever fibres pass through them are cut,
// and the visual-field charts are computed from which fibres survive — nothing is hard-coded.
import * as THREE from 'three';
import { G, DISC, RIGHT, LEFT, SIDES, eyeCenter, retinaLocal, mulberry, toonRamp } from './anatomy.js';

const DEG = Math.PI / 180;
export const SPEED = 150; // mm/s — displayed conduction, slowed ~100× so you can follow it
const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ Jansonius 2009
function trajectory(phi0) {
  let b, c;
  if (phi0 > 0) {
    b = Math.exp(-1.9 + 3.9 * Math.tanh(-(phi0 - 121) / 14));
    c = 1.9 + 1.4 * Math.tanh((phi0 - 121) / 14);
  } else {
    b = -Math.exp(0.7 + 1.5 * Math.tanh(-(-phi0 - 90) / 25));
    c = 1.0 + 0.5 * Math.tanh((-phi0 - 90) / 25);
  }
  const pts = [];
  for (let r = 4; r <= 60; r += 0.5) {
    const phi = phi0 + b * Math.pow(r - 4, c);
    if (phi0 > 0 ? phi > 180 : phi < -180) break; // reached the horizontal raphe
    const x = r * Math.cos(phi * DEG) + DISC.x;
    let y = r * Math.sin(phi * DEG);
    if (x > 0) y += DISC.y * (x / DISC.x) ** 2;
    else y += 0;
    if (Math.hypot(x, y) > 62) break;
    pts.push({ x, y, r });
  }
  return pts;
}

export const BUNDLES = [];
for (let p = -179.5; p <= 179.5; p += 1) BUNDLES.push({ phi0: p, pts: trajectory(p) });

function nearestBundle(x, y) {
  let best = Infinity, bb = null, bi = 0;
  for (const B of BUNDLES) {
    const P = B.pts;
    for (let i = 0; i < P.length; i++) {
      const d = (P[i].x - x) ** 2 + (P[i].y - y) ** 2;
      if (d < best) {
        best = d;
        bb = B;
        bi = i;
      }
    }
  }
  return { bundle: bb, index: bi };
}

// ------------------------------------------------------------------ V1 retinotopy
const V1 = { e0: 0.75, eMax: 60 };
const V1_POLE = (h) => new THREE.Vector3(h * 5, 8, -171);
const V1_ANT = (h) => new THREE.Vector3(h * 5, 18, -128);
const V1_UP = new THREE.Vector3(0, 0.974, -0.226);
export const v1U = (e) => Math.log(1 + e / V1.e0) / Math.log(1 + V1.eMax / V1.e0);
export function v1Point(h, e, alphaDeg, out = new THREE.Vector3()) {
  const u = v1U(Math.min(e, V1.eMax));
  return v1UV(h, u, -alphaDeg / 90, out);
}
function v1UV(h, u, v, out = new THREE.Vector3()) {
  out.copy(V1_POLE(h)).lerp(V1_ANT(h), u);
  const w = 3 + 10 * u;
  out.addScaledVector(V1_UP, v * w);
  out.x = h * (3.5 + 7 * Math.exp(-6 * u) + 4.5 * (1 - v * v) * (0.4 + 0.6 * u));
  return out;
}

// ------------------------------------------------------------------ path skeleton
const E = { [RIGHT]: eyeCenter(RIGHT), [LEFT]: eyeCenter(LEFT) };
const discLocal = (n, r) => retinaLocal(DISC.x, DISC.y, n, r);
function skeleton(s) {
  const n = -s;
  const e = E[s];
  const W = (x, y, z) => new THREE.Vector3(x, y, z);
  return {
    exit: discLocal(n, 12.4).add(e),
    nerve: [W(e.x + n * 6.5, 1.5, -18), W(e.x + n * 11, 3.2, -27), W(s * 14.5, 5, -37.5), W(s * 10.5, 7, -46.5), W(s * 6.5, 8, -55.5)],
    uncrossed: W(s * 7.6, 8, -61),
  };
}
const CROSS = new THREE.Vector3(0, 8.6, -61);
const tractPts = (h) => [new THREE.Vector3(h * 6.8, 7.6, -66.5), new THREE.Vector3(h * 11.5, 6, -73), new THREE.Vector3(h * 17, 3.5, -80)];
export const LGN_C = (h) => new THREE.Vector3(h * 22, 1.5, -86.5);
const PARIETAL = (h) => [new THREE.Vector3(h * 26, 7, -97), new THREE.Vector3(h * 28.5, 13, -118), new THREE.Vector3(h * 22, 15, -142)];
const MEYER = (h) => [new THREE.Vector3(h * 29, -5, -83), new THREE.Vector3(h * 35, -10, -72), new THREE.Vector3(h * 40, -7, -93), new THREE.Vector3(h * 34, 1, -123), new THREE.Vector3(h * 21, 8, -146)];
const LGN_LAYERS = { contra: [1, 4, 6], ipsi: [2, 3, 5] };
const lgnRadius = (layer) => 1.3 + (layer - 1) * 0.62;
function lgnPoint(h, layer, fy, ecc, out = new THREE.Vector3()) {
  const a = Math.PI / 2 + THREE.MathUtils.clamp(fy / 60, -1, 1) * 1.2 * h;
  const r = lgnRadius(layer);
  return out.copy(LGN_C(h)).add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r - 1.5, (ecc / 60 - 0.4) * 5));
}

// ------------------------------------------------------------------ fibre sampling
const ECC = [0.8, 1.8, 3, 4.5, 6.5, 9, 12, 16, 21, 27, 34, 42, 50];
function sampleField() {
  const out = [];
  const rand = mulberry(21);
  ECC.forEach((e, k) => {
    const nA = 4 * Math.round(0.35 * e + 2);
    for (let j = 0; j < nA; j++) {
      const a = ((j + 0.5 + (rand() - 0.5) * 0.5) / nA) * Math.PI * 2;
      const ee = e * (1 + (rand() - 0.5) * 0.18) + (k === 0 ? 0 : 0);
      out.push({ fx: Math.cos(a) * ee, fy: Math.sin(a) * ee });
    }
  });
  return out;
}

// ------------------------------------------------------------------ shaders
export const skinUniforms = {
  uRotR: { value: new THREE.Matrix3() },
  uRotL: { value: new THREE.Matrix3() },
  uCenR: { value: E[RIGHT].clone() },
  uCenL: { value: E[LEFT].clone() },
};

const skinChunk = /* glsl */ `
  uniform mat3 uRotR; uniform mat3 uRotL; uniform vec3 uCenR; uniform vec3 uCenL;
  vec3 skin(vec3 p, float w, float right) {
    if (w <= 0.0) return p;
    mat3 R = right > 0.5 ? uRotR : uRotL; vec3 C = right > 0.5 ? uCenR : uCenL;
    return mix(p, C + R * (p - C), w);
  }`;

function sheathMaterial(color, alpha) {
  return new THREE.ShaderMaterial({
    uniforms: { ...skinUniforms, uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
    vertexShader: /* glsl */ `
      attribute float aW; attribute float aRight;
      ${skinChunk}
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 p = skin(position, aW, aRight);
        vec3 nn = aW > 0.0 ? normalize(mix(normal, (aRight > 0.5 ? uRotR : uRotL) * normal, aW)) : normal;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = -mv.xyz; vN = normalMatrix * nn;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.8);
        gl_FragColor = vec4(uColor * (0.3 + 0.9 * f), uAlpha * (0.25 + f)); }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------------ the pathway
export const EYE_COL = { [RIGHT]: new THREE.Color('#46d6ff'), [LEFT]: new THREE.Color('#ff5fae') };
export const FIELD_COL = { left: new THREE.Color('#5d8bff'), right: new THREE.Color('#ffa845') };
const RAD_COL = new THREE.Color('#ffd27a');

export class Pathway {
  constructor() {
    this.world = new THREE.Group();
    this.intra = { [RIGHT]: new THREE.Group(), [LEFT]: new THREE.Group() };
    this.fibers = [];
    this.lesions = [];
    this.time = 0;
    this.buildFibers();
    this.buildTexture();
    this.buildFiberMeshes();
    this.buildSheaths();
    this.buildLGN();
    this.buildV1();
    this.buildRNFL();
    this.buildStimulus();
    this.buildFieldLookup();
    this.lesionGroup = new THREE.Group();
    this.world.add(this.lesionGroup);
    this.anchors = this.makeAnchors();
  }

  buildFibers() {
    const field = sampleField();
    const rand = mulberry(5);
    const tmp = new THREE.Vector3();
    for (const s of SIDES) {
      const n = -s;
      const sk = skeleton(s);
      for (const f of field) {
        const xr = n * f.fx;
        const yr = -f.fy;
        if (Math.hypot(xr - DISC.x, yr - DISC.y) < DISC.r + 0.4) continue; // blind spot: no photoreceptors
        const ecc = Math.hypot(f.fx, f.fy);
        const crossed = xr > 0;
        const h = crossed ? -s : s;
        const alpha = Math.atan2(f.fy, Math.abs(f.fx)) / DEG;
        const meyer = smooth(-0.15, 0.4, Math.sin(alpha * DEG));
        const fib = { side: s, fx: f.fx, fy: f.fy, xr, yr, ecc, crossed, h, alpha, meyer, act: 0, target: 0, onset: -1, cut: 1e9 };

        // ---- intraocular: along the Jansonius bundle to the disc, then out through the lamina
        const { bundle, index } = nearestBundle(xr, yr);
        const intra = [retinaLocal(xr, yr, n, G.retinaR - 0.05)];
        for (let i = index; i >= 0; i -= 3) {
          const p = bundle.pts[i];
          intra.push(retinaLocal(p.x, p.y, n, G.retinaR - 0.05));
        }
        const rim = bundle.pts[0];
        const dx = (rim.x - DISC.x) * 0.35;
        const dy = (rim.y - DISC.y) * 0.35;
        intra.push(retinaLocal(DISC.x + dx, DISC.y + dy, n, G.retinaR - 0.3));
        intra.push(retinaLocal(DISC.x + dx * 0.9, DISC.y + dy * 0.9, n, G.retinaR + 0.6));
        // retinotopic place in the nerve: temporal fibres lateral, superior fibres up
        const ox = s * THREE.MathUtils.clamp(-xr / 40, -1, 1) * 1.25 + (rand() - 0.5) * 0.35;
        const oy = THREE.MathUtils.clamp(yr / 40, -1, 1) * 1.25 + (rand() - 0.5) * 0.35;
        const exitL = discLocal(n, 12.4).add(tmp.set(ox * 0.45, oy * 0.45, 0));
        intra.push(exitL);
        fib.intra = intra;

        // ---- extraocular control points
        const off = (p, k, zOff = 0) => p.clone().add(new THREE.Vector3(ox * k, oy * k, zOff));
        const ctrl = [exitL.clone().add(E[s])];
        const ks = [1.0, 1.15, 1.2, 1.1, 1.2];
        sk.nerve.forEach((p, i) => ctrl.push(off(p, ks[i])));
        if (crossed) ctrl.push(CROSS.clone().add(new THREE.Vector3(0, oy * 1.1, ox * s * 1.1 + (rand() - 0.5))));
        else ctrl.push(off(sk.uncrossed, 1.0));
        // tract: fibres from both eyes for the same field point run together
        const tx = (Math.abs(f.fx) / 50 - 0.5) * 2.2 + (rand() - 0.5) * 0.4;
        const ty = (f.fy / 50) * 2.2 + (rand() - 0.5) * 0.4;
        tractPts(h).forEach((p, i) => ctrl.push(p.clone().add(new THREE.Vector3(h * tx * (i ? 0.4 : 0.2), ty, i ? tx * 0.8 : 0))));
        const set = crossed ? LGN_LAYERS.contra : LGN_LAYERS.ipsi;
        const layer = ecc > 24 ? set[0] : set[1 + ((rand() * 2) | 0)];
        fib.layer = layer;
        ctrl.push(lgnPoint(h, layer, f.fy, ecc));
        // radiation: blend the parietal and Meyer routes by where the fibre sits in the field
        const par = new THREE.CatmullRomCurve3([LGN_C(h), ...PARIETAL(h)]).getSpacedPoints(8).slice(1);
        const mey = new THREE.CatmullRomCurve3([LGN_C(h), ...MEYER(h)]).getSpacedPoints(8).slice(1);
        const rj = new THREE.Vector3((rand() - 0.5) * 3, (rand() - 0.5) * 3, 0);
        for (let i = 0; i < par.length; i++) {
          const p = par[i].clone().lerp(mey[i], meyer).add(rj);
          p.y += (-f.fy / 60) * 3;
          ctrl.push(p);
        }
        fib.v1 = v1Point(h, ecc, alpha);
        fib.v1u = v1U(ecc);
        ctrl.push(fib.v1.clone());

        const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
        const len = curve.getLength();
        fib.extra = curve.getSpacedPoints(Math.max(40, Math.round(len / 1.6)));
        this.fibers.push(fib);
      }
    }
    // arc lengths
    for (const f of this.fibers) {
      let s = 0;
      f.sIntra = [0];
      for (let i = 1; i < f.intra.length; i++) f.sIntra.push((s += f.intra[i].distanceTo(f.intra[i - 1])));
      f.sExit = s;
      f.sExtra = [s];
      for (let i = 1; i < f.extra.length; i++) f.sExtra.push((s += f.extra[i].distanceTo(f.extra[i - 1])));
      f.total = s;
      // arc length at the LGN synapse
      const L = LGN_C(f.h);
      let best = Infinity;
      f.extra.forEach((p, i) => {
        const d = p.distanceTo(L);
        if (d < best) {
          best = d;
          f.sLGN = f.sExtra[i];
        }
      });
    }
  }

  buildTexture() {
    const W = 1024;
    this.texData = new Float32Array(W * 2 * 4);
    this.tex = new THREE.DataTexture(this.texData, W, 2, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.fibers.forEach((f, i) => {
      this.texData[i * 4 + 0] = 0;
      this.texData[i * 4 + 1] = 1e9;
      this.texData[i * 4 + 2] = f.side === RIGHT ? 0 : 1;
      this.texData[i * 4 + 3] = f.fx < 0 ? 0 : 1;
      this.texData[(W + i) * 4] = -100;
    });
    this.tex.needsUpdate = true;
  }

  buildFiberMeshes() {
    this.fiberMat = new THREE.ShaderMaterial({
      uniforms: {
        ...skinUniforms,
        uAct: { value: this.tex },
        uTime: { value: 0 },
        uSpeed: { value: SPEED },
        uSpacing: { value: 11 },
        uBase: { value: 0.075 },
        uMode: { value: 0 },
        uColR: { value: EYE_COL[RIGHT] },
        uColL: { value: EYE_COL[LEFT] },
        uColFL: { value: FIELD_COL.left },
        uColFR: { value: FIELD_COL.right },
        uColRad: { value: RAD_COL },
      },
      vertexShader: /* glsl */ `
        attribute float aS; attribute float aFiber; attribute float aW; attribute float aSeg;
        uniform sampler2D uAct;
        ${skinChunk}
        varying float vS; varying vec4 vA; varying float vOnset; varying float vSeg;
        void main(){
          vA = texelFetch(uAct, ivec2(int(aFiber), 0), 0);
          vOnset = texelFetch(uAct, ivec2(int(aFiber), 1), 0).r;
          vS = aS; vSeg = aSeg;
          vec3 p = skin(position, aW, 1.0 - vA.b);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uSpeed; uniform float uSpacing; uniform float uBase; uniform int uMode;
        uniform vec3 uColR; uniform vec3 uColL; uniform vec3 uColFL; uniform vec3 uColFR; uniform vec3 uColRad;
        varying float vS; varying vec4 vA; varying float vOnset; varying float vSeg;
        void main(){
          float alive = step(vS, vA.g);
          vec3 eyeCol = vA.b < 0.5 ? uColR : uColL;
          vec3 col = uMode == 0 ? mix(eyeCol, uColRad, step(0.5, vSeg)) : (vA.a < 0.5 ? uColFL : uColFR);
          float front = (uTime - vOnset) * uSpeed;
          float reached = step(vS, front);
          float ph = fract((vS - uTime * uSpeed) / uSpacing);
          float pulse = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.05, 0.22, ph));
          float act = vA.r * alive * reached;
          float edge = act * exp(-abs(vS - front) * 0.25) * step(vS, front + 1.0);
          vec3 c = col * uBase * mix(0.12, 1.0, alive) + col * act * 0.35 + mix(col, vec3(1.0), 0.5) * (pulse * act * 2.4 + edge * 1.5);
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const mk = (fibers, key, sKey, local) => {
      const pos = [], aS = [], aF = [], aW = [], aSeg = [], idx = [];
      let base = 0;
      for (const f of fibers) {
        const pts = f[key];
        const ss = f[sKey];
        const fi = this.fibers.indexOf(f);
        for (let i = 0; i < pts.length; i++) {
          pos.push(pts[i].x, pts[i].y, pts[i].z);
          aS.push(ss[i]);
          aF.push(fi);
          aW.push(local ? 0 : 1 - smooth(0, 26, ss[i] - f.sExit));
          aSeg.push(ss[i] > f.sLGN ? 1 : 0);
          if (i) idx.push(base + i - 1, base + i);
        }
        base += pts.length;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
      g.setAttribute('aFiber', new THREE.Float32BufferAttribute(aF, 1));
      g.setAttribute('aW', new THREE.Float32BufferAttribute(aW, 1));
      g.setAttribute('aSeg', new THREE.Float32BufferAttribute(aSeg, 1));
      g.setIndex(idx);
      const m = new THREE.LineSegments(g, this.fiberMat);
      m.frustumCulled = false;
      m.renderOrder = 5;
      return m;
    };
    this.extraMesh = mk(this.fibers, 'extra', 'sExtra', false);
    this.world.add(this.extraMesh);
    for (const s of SIDES) {
      const m = mk(this.fibers.filter((f) => f.side === s), 'intra', 'sIntra', true);
      this.intra[s].add(m);
    }
  }

  buildSheaths() {
    this.sheaths = new THREE.Group();
    const nerveMat = sheathMaterial('#9fd8ff', 0.16);
    const brainMat = sheathMaterial('#c9b3ff', 0.1);
    const radMat = sheathMaterial('#ffd6a0', 0.06);
    const tube = (pts, r, mat, skinSide = 0, name = '') => {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const segs = Math.max(24, Math.round(curve.getLength() / 1.5));
      const g = new THREE.TubeGeometry(curve, segs, r, 18, false);
      const count = g.attributes.position.count;
      const w = new Float32Array(count);
      const right = new Float32Array(count).fill(skinSide === RIGHT ? 1 : 0);
      if (skinSide) {
        const L = curve.getLength();
        for (let i = 0; i < count; i++) {
          const ring = Math.floor(i / 19);
          w[i] = 1 - smooth(0, 26, (ring / segs) * L);
        }
      }
      g.setAttribute('aW', new THREE.BufferAttribute(w, 1));
      g.setAttribute('aRight', new THREE.BufferAttribute(right, 1));
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      m.renderOrder = 4;
      this.sheaths.add(m);
      return m;
    };
    this.nerveSheaths = {};
    for (const s of SIDES) {
      const sk = skeleton(s);
      this.nerveSheaths[s] = tube([sk.exit, ...sk.nerve], 1.9, nerveMat, s, 'optic nerve');
      tube([sk.nerve[4], sk.uncrossed, tractPts(s)[0]], 1.5, nerveMat, 0, 'optic chiasm');
      tube([sk.nerve[4], CROSS, tractPts(-s)[0]], 1.7, nerveMat, 0, 'optic chiasm');
      tube([...tractPts(s), LGN_C(s)], 1.8, brainMat, 0, 'optic tract');
      tube([LGN_C(s), ...PARIETAL(s), v1Point(s, 20, -45)], 3.2, radMat, 0, 'optic radiation');
      tube([LGN_C(s), ...MEYER(s), v1Point(s, 20, 45)], 3.2, radMat, 0, "Meyer's loop");
    }
    this.world.add(this.sheaths);
  }

  buildLGN() {
    this.lgn = { [RIGHT]: [], [LEFT]: [] };
    const g = new THREE.Group();
    for (const h of SIDES) {
      for (let layer = 1; layer <= 6; layer++) {
        const arc = Math.PI * 1.25;
        const geo = new THREE.TorusGeometry(lgnRadius(layer), 0.26, 8, 40, arc);
        geo.rotateZ((Math.PI - arc) / 2);
        const magno = layer <= 2;
        const mat = new THREE.MeshToonMaterial({ color: magno ? 0x8a93ff : 0xd7b7ff, emissive: magno ? 0x303b98 : 0x7549a0, emissiveIntensity: 0.14, gradientMap: toonRamp(), transparent: true, opacity: 0.9 });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(LGN_C(h)).add(new THREE.Vector3(0, -1.5, 0));
        m.scale.z = 3.5;
        m.userData = { layer, h };
        g.add(m);
        this.lgn[h].push(m);
      }
    }
    this.world.add(g);
  }

  buildV1() {
    this.v1Mesh = {};
    const NU = 48, NV = 24;
    for (const h of SIDES) {
      const pos = [], col = [], uvs = [], idx = [];
      const p = new THREE.Vector3();
      for (let i = 0; i <= NU; i++) {
        for (let j = 0; j <= NV; j++) {
          const u = i / NU, v = (j / NV) * 2 - 1;
          v1UV(h, u, v, p);
          pos.push(p.x, p.y, p.z);
          uvs.push(u, v);
          col.push(0, 0, 0);
          if (i < NU && j < NV) {
            const a = i * (NV + 1) + j;
            idx.push(a, a + NV + 1, a + 1, a + 1, a + NV + 1, a + NV + 2);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = 3;
      this.v1Mesh[h] = m;
      this.world.add(m);
    }
    this.paintV1();

    // activity hot-spots: one sprite per fibre at its cortical target
    const n = this.fibers.length;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    this.fibers.forEach((f, i) => pos.set([f.v1.x, f.v1.y, f.v1.z], i * 3));
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.v1Act = new Float32Array(n);
    g.setAttribute('aAct', new THREE.BufferAttribute(this.v1Act, 1));
    this.v1Points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader: /* glsl */ `attribute float aAct; varying float vA; uniform float uScale;
        void main(){ vA = aAct; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = (4.0 + 26.0*aAct) * uScale * 180.0 / -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: /* glsl */ `varying float vA; void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); if (vA < 0.01) discard;
        float g = exp(-r*r*18.0); gl_FragColor = vec4(vec3(1.0,0.86,0.55)*g*vA*1.6, 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.v1Points.frustumCulled = false;
    this.v1Points.renderOrder = 6;
    this.world.add(this.v1Points);
  }

  paintV1() {
    for (const h of SIDES) {
      const g = this.v1Mesh[h].geometry;
      const uv = g.attributes.uv;
      const col = g.attributes.color;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        // eccentricity bands at 1, 2.5, 5, 10, 20, 40°
        let band = 0;
        for (const e of [1, 2.5, 5, 10, 20, 40]) band = Math.max(band, Math.exp(-(((u - v1U(e)) / 0.008) ** 2)));
        const meridian = Math.exp(-((v / 0.05) ** 2)) * 0.6;
        const up = v < 0; // upper field sits below the calcarine
        let r = up ? 0.2 : 0.1, gg = 0.12, b = up ? 0.16 : 0.26;
        r += band * 0.35 + meridian * 0.3;
        gg += band * 0.3 + meridian * 0.3;
        b += band * 0.3 + meridian * 0.3;
        const lesioned = this.lesions.some((L) => L.type === 'v1' && L.h === h && u >= L.uMin && u <= L.uMax);
        if (lesioned) {
          r = 0.42;
          gg = 0.04;
          b = 0.06;
        }
        col.setXYZ(i, r, gg, b);
      }
      col.needsUpdate = true;
    }
  }

  // RNFL: the nerve-fibre bundles painted on the inside of each retina
  buildRNFL() {
    this.rnfl = {};
    for (const s of SIDES) {
      const n = -s;
      const pos = [];
      const tmp = new THREE.Vector3();
      const tmp2 = new THREE.Vector3();
      BUNDLES.forEach((B, k) => {
        if (k % 3) return;
        const P = B.pts;
        for (let i = 1; i < P.length; i++) {
          retinaLocal(P[i - 1].x, P[i - 1].y, n, G.retinaR - 0.03, tmp);
          retinaLocal(P[i].x, P[i].y, n, G.retinaR - 0.03, tmp2);
          pos.push(tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.y, tmp2.z);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xfff1d8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.rnfl[s] = m;
      this.intra[s].add(m);
    }
  }

  buildStimulus() {
    const g = new THREE.Group();
    const orb = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe2a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.set(26, 26, 1);
    orb.add(halo);
    g.add(orb);
    const rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(2 * 3 * 4), 3));
    const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color: 0xffe7a8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    rays.frustumCulled = false;
    g.add(rays);
    this.stim = { group: g, orb, rays };
    this.world.add(g);
  }

  // nearest fibre lookup for each visual-field chart cell
  buildFieldLookup() {
    const N = 61, R = 60, step = (2 * R) / (N - 1);
    this.grid = { N, R, step, cells: {} };
    for (const s of SIDES) {
      const fibs = this.fibers.map((f, i) => ({ f, i })).filter(({ f }) => f.side === s);
      const cells = new Int32Array(N * N).fill(-2);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const fx = -R + i * step, fy = R - j * step;
          if (Math.hypot(fx, fy) > R) continue;
          const xr = -s * fx, yr = -fy;
          if (Math.hypot(xr - DISC.x, yr - DISC.y) < DISC.r) {
            cells[j * N + i] = -1; // blind spot
            continue;
          }
          let best = Infinity, bi = -2;
          for (const { f, i: k } of fibs) {
            if (Math.sign(f.fx) !== Math.sign(fx || 1e-6)) continue;
            const d = (f.fx - fx) ** 2 + (f.fy - fy) ** 2;
            if (d < best) {
              best = d;
              bi = k;
            }
          }
          cells[j * N + i] = bi;
        }
      }
      this.grid.cells[s] = cells;
    }
  }

  makeAnchors() {
    const sk = skeleton(RIGHT);
    return {
      nerve: sk.nerve[1].clone(),
      chiasm: CROSS.clone().add(new THREE.Vector3(0, 3, 0)),
      tract: tractPts(LEFT)[2].clone(),
      lgn: LGN_C(LEFT).clone().add(new THREE.Vector3(0, 4, 0)),
      meyer: MEYER(RIGHT)[1].clone(),
      radiation: PARIETAL(LEFT)[1].clone(),
      v1: v1Point(LEFT, 8, 0),
      retina: eyeCenter(LEFT).add(new THREE.Vector3(0, 6, -9)),
    };
  }

  // ---------------------------------------------------------------- lesions
  setLesions(list) {
    this.lesions = list;
    const tmp = new THREE.Vector3();
    for (const f of this.fibers) {
      f.cut = 1e9;
      const e = eyeCenter(f.side);
      for (const L of list) {
        if (L.type === 'v1') {
          if (f.h === L.h && f.v1u >= L.uMin && f.v1u <= L.uMax) f.cut = Math.min(f.cut, f.total - 3);
          continue;
        }
        const r2 = L.r * L.r;
        let hit = -1;
        for (let i = 0; i < f.intra.length && hit < 0; i++) if (tmp.copy(f.intra[i]).add(e).distanceToSquared(L.pos) < r2) hit = f.sIntra[i];
        for (let i = 0; i < f.extra.length && hit < 0; i++) if (f.extra[i].distanceToSquared(L.pos) < r2) hit = f.sExtra[i];
        if (hit >= 0) f.cut = Math.min(f.cut, hit);
      }
    }
    this.fibers.forEach((f, i) => (this.texData[i * 4 + 1] = f.cut));
    this.tex.needsUpdate = true;
    this.paintV1();
    // markers
    this.lesionGroup.clear();
    for (const L of list) {
      if (L.type === 'v1') continue;
      const m = new THREE.Mesh(new THREE.SphereGeometry(L.r, 32, 20), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.position.copy(L.pos);
      const ring = new THREE.Mesh(new THREE.SphereGeometry(L.r * 1.02, 32, 20), new THREE.MeshBasicMaterial({ color: 0xff6b6b, wireframe: true, transparent: true, opacity: 0.25, depthWrite: false }));
      m.add(ring);
      this.lesionGroup.add(m);
    }
  }

  // ---------------------------------------------------------------- field charts
  // 0 outside, 1 seen, 2 lost, 3 blind spot
  fieldGrid(side) {
    const { N, cells: C } = this.grid;
    const cells = C[side];
    const out = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) {
      const c = cells[k];
      if (c === -2) out[k] = 0;
      else if (c === -1) out[k] = 3;
      else out[k] = this.fibers[c].cut < this.fibers[c].total ? 2 : 1;
    }
    return out;
  }

  // ---------------------------------------------------------------- per-frame
  setColorMode(m) {
    this.fiberMat.uniforms.uMode.value = m;
  }

  update(dt, t, stim) {
    this.time = t;
    this.fiberMat.uniforms.uTime.value = t;
    const W = 1024;
    const seen = { [RIGHT]: false, [LEFT]: false };
    const lgnAct = { [RIGHT]: new Float32Array(7), [LEFT]: new Float32Array(7) };
    const flashOn = stim.mode === 'flash' && t % 2.6 < 0.55;
    this.fibers.forEach((f, i) => {
      let a = 0;
      if (stim.mode === 'probe') {
        const d = Math.hypot(f.fx - stim.fx, f.fy - stim.fy);
        const rr = stim.r + 0.07 * f.ecc;
        a = Math.exp(-((d / rr) ** 2) * 1.4);
        if (a < 0.15) a = 0;
      } else if (flashOn) a = 1;
      if (a > 0 && f.onset < 0) {
        f.onset = t;
        this.texData[(W + i) * 4] = t;
      } else if (a === 0 && f.act < 0.02 && f.onset >= 0) {
        f.onset = -1;
        this.texData[(W + i) * 4] = 1e6;
      }
      f.act += (a - f.act) * Math.min(1, dt * 10);
      this.texData[i * 4] = f.act;
      const travelled = f.onset >= 0 ? (t - f.onset) * SPEED : -1;
      const alive = f.cut >= f.total;
      const arrived = alive && travelled > f.total ? f.act : 0;
      this.v1Act[i] = arrived;
      if (f.cut > f.sLGN && travelled > f.sLGN) lgnAct[f.h][f.layer] += f.act;
      if (alive && f.act > 0.35) seen[f.side] = true;
    });
    this.tex.needsUpdate = true;
    this.v1Points.geometry.attributes.aAct.needsUpdate = true;
    for (const h of SIDES) {
      for (const m of this.lgn[h]) {
        const v = Math.min(lgnAct[h][m.userData.layer] / 3, 1);
        m.material.emissiveIntensity += (0.15 + v * 2.2 - m.material.emissiveIntensity) * Math.min(1, dt * 8);
      }
    }
    // stimulus orb + light paths into each eye
    const on = stim.mode === 'probe' || flashOn;
    this.stim.group.visible = stim.mode === 'probe';
    if (stim.mode === 'probe') {
      const dir = new THREE.Vector3(-Math.sin(stim.fx * DEG) * Math.cos(stim.fy * DEG), Math.sin(stim.fy * DEG), Math.cos(stim.fx * DEG) * Math.cos(stim.fy * DEG));
      this.stim.orb.position.copy(dir).multiplyScalar(130);
      const p = this.stim.rays.geometry.attributes.position;
      let k = 0;
      for (const s of SIDES) {
        const e = eyeCenter(s);
        const cornea = e.clone().add(new THREE.Vector3(0, 0, G.apex));
        const ret = retinaLocal(-s * stim.fx, -stim.fy, -s, G.retinaR).add(e);
        p.setXYZ(k++, this.stim.orb.position.x, this.stim.orb.position.y, this.stim.orb.position.z);
        p.setXYZ(k++, cornea.x, cornea.y, cornea.z);
        p.setXYZ(k++, cornea.x, cornea.y, cornea.z);
        p.setXYZ(k++, ret.x, ret.y, ret.z);
      }
      p.needsUpdate = true;
    }
    return { seen, on };
  }
}

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

// Clinical lesion presets — positions are just places on the model; the resulting
// field defects come out of the fibre geometry.
export function lesionPresets() {
  const R = skeleton(RIGHT);
  const discR = retinaLocal(DISC.x, DISC.y - 3.4, 1, G.retinaR).add(eyeCenter(RIGHT));
  return [
    { id: 'none', label: 'Intact', list: [], note: 'All ~850 modelled axons intact. Each chart shows one eye’s field; the black dot is that eye’s blind spot, ~15° temporal to fixation, where the optic disc has no photoreceptors.' },
    { id: 'glaucoma', label: 'Glaucoma (R disc)', list: [{ type: 'sphere', pos: discR, r: 0.75 }], note: 'Damage at the inferior rim of the right optic disc. The fibres there come from the inferior retina and arc around the fovea (Jansonius trajectories), so the loss is an <b>arcuate scotoma in the superior field</b> that stops sharply at the horizontal midline.' },
    { id: 'nerve', label: 'R optic nerve', list: [{ type: 'sphere', pos: R.nerve[1].clone(), r: 3.2 }], note: 'Every axon from the right eye passes through the optic nerve, so cutting it blinds <b>the right eye only</b>. The left eye’s field is untouched. The pupil would also fail to react to light shone in the right eye (a relative afferent pupillary defect).' },
    { id: 'chiasm', label: 'Chiasm (pituitary)', list: [{ type: 'sphere', pos: CROSS.clone().add(new THREE.Vector3(0, -1.4, 0)), r: 3.6 }], note: 'A pituitary tumour presses on the middle of the chiasm, where only the <b>crossing nasal fibres</b> run. Both temporal fields are lost: <b>bitemporal hemianopia</b>. The patient may bump into things on both sides.' },
    { id: 'tract', label: 'L optic tract', list: [{ type: 'sphere', pos: tractPts(LEFT)[1].clone(), r: 3.2 }], note: 'Behind the chiasm each tract carries the <b>opposite half of the world</b> from both eyes. A left tract lesion causes <b>right homonymous hemianopia</b>, which is often incongruous because the two eyes’ fibres are not yet perfectly interleaved.' },
    { id: 'meyer', label: 'R Meyer’s loop', list: [{ type: 'sphere', pos: MEYER(RIGHT)[1].clone().add(new THREE.Vector3(0, 0, -2)), r: 4.2 }], note: 'Radiation fibres for the upper field detour forward around the temporal horn. A right temporal-lobe lesion (e.g. after epilepsy surgery) gives a <b>left superior quadrantanopia</b>: “pie in the sky”.' },
    { id: 'parietal', label: 'L parietal radiation', list: [{ type: 'sphere', pos: PARIETAL(LEFT)[1].clone(), r: 4.5 }], note: 'Fibres for the lower field take the direct parietal route. A left parietal lesion causes a <b>right inferior quadrantanopia</b>: “pie on the floor”.' },
    { id: 'v1', label: 'R occipital (PCA stroke)', list: [{ type: 'v1', h: RIGHT, uMin: 0.34, uMax: 1.01 }], note: 'A right posterior cerebral artery stroke destroys most of the right V1, causing <b>left homonymous hemianopia</b>. The occipital pole, where the central 2–3° are mapped, often has a second blood supply from the MCA, so central vision survives: <b>macular sparing</b>.' },
  ];
}
