import * as THREE from 'three';

// All geometry is in millimetres. The subject faces +z, +y is up and the
// subject's right is −x, so a camera in front sees the right eye on its left.
export const IPD = 62;
export const RIGHT = -1;
export const LEFT = 1;
export const SIDES = [RIGHT, LEFT];
export const eyeCenter = (side) => new THREE.Vector3((side * IPD) / 2, 0, 0);

// Globe centred on its rotation centre. Corneal vertex 12.5 mm in front,
// so a 24 mm axial length puts the retina 11.5 mm behind the centre.
export const G = {
  R: 11.5,
  apex: 12.5,
  retinaR: 11.0,
  choroidR: 11.22,
  mmPerDeg: 0.29, // retinal mm per degree of visual angle
  limbusZ: 9.947,
  limbusR: 5.77,
};
export const DISC = { x: 15, y: 2, r: 2.8 }; // optic disc centre (retinal °, x nasal, y superior)
export const IRIS_Z = 9.2;

const TAU = Math.PI * 2;
const FUNDUS_HALF = 30;

// Retinal coordinates (degrees, x nasal, y superior) → eye-local point on a sphere of radius r.
export function retinaLocal(xDeg, yDeg, nasal, r = G.retinaR, out = new THREE.Vector3()) {
  const h = Math.hypot(xDeg, yDeg);
  const th = (h * G.mmPerDeg) / G.retinaR;
  const ux = h > 1e-6 ? xDeg / h : 0;
  const uy = h > 1e-6 ? yDeg / h : 0;
  const s = Math.sin(th);
  return out.set(nasal * ux * s * r, uy * s * r, -Math.cos(th) * r);
}

export function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ profiles
function arc(R, th0, th1, n, stretch) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = th0 + ((th1 - th0) * i) / n;
    let z = -R * Math.cos(th);
    if (z < 0) z *= stretch;
    pts.push(new THREE.Vector2(Math.max(R * Math.sin(th), 1e-4), z));
  }
  return pts;
}

function capArc(R, c, zFrom, zTo, n) {
  // sphere of radius R centred on the axis at z=c; points ordered zFrom → zTo along the surface
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const z = zFrom + ((zTo - zFrom) * i) / n;
    pts.push(new THREE.Vector2(Math.sqrt(Math.max(R * R - (z - c) * (z - c), 0)) + 1e-4, z));
  }
  return pts;
}

function lathe(points, cut, segs, uvFn) {
  const phiLength = TAU * (1 - cut);
  const phiStart = Math.PI * (1 + cut);
  const g = new THREE.LatheGeometry(points, Math.max(12, Math.round(segs * (1 - cut))), phiStart, phiLength);
  g.rotateX(Math.PI / 2);
  if (uvFn) {
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const [a, b] = uvFn(v);
      uv.setXY(i, a, b);
    }
  }
  return g;
}

export function lensShape(A) {
  const zf = G.apex - 3.6 + 0.4 * A;
  const Rf = 10 - 4.67 * A;
  const zb = G.apex - 7.2;
  const Rb = 6 - 0.67 * A;
  const cf = zf - Rf;
  const cb = zb + Rb;
  const zEq = (Rf * Rf - Rb * Rb - cf * cf + cb * cb) / (2 * (cb - cf));
  const rEq = Math.sqrt(Math.max(Rf * Rf - (zEq - cf) ** 2, 0));
  return { zf, Rf, zb, Rb, cf, cb, zEq, rEq };
}

// ------------------------------------------------------------------ textures
function fundusCanvas() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const mm = S / (2 * FUNDUS_HALF);
  const P = (x, y) => [(x + FUNDUS_HALF) * mm, (FUNDUS_HALF - y) * mm];
  const rand = mulberry(7);
  const disc = [DISC.x * G.mmPerDeg, DISC.y * G.mmPerDeg];

  let [fx, fy] = P(0, 0);
  let gr = g.createRadialGradient(fx, fy, 0, fx, fy, FUNDUS_HALF * mm);
  gr.addColorStop(0, '#c4502a');
  gr.addColorStop(0.3, '#b04322');
  gr.addColorStop(0.7, '#7c2615');
  gr.addColorStop(1, '#2c0a06');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);

  for (let i = 0; i < 3200; i++) {
    const x = (rand() * 2 - 1) * FUNDUS_HALF;
    const y = (rand() * 2 - 1) * FUNDUS_HALF;
    const [px, py] = P(x, y);
    g.fillStyle = rand() < 0.5 ? `rgba(70,12,6,${0.05 + rand() * 0.09})` : `rgba(230,110,60,${0.03 + rand() * 0.05})`;
    g.beginPath();
    g.ellipse(px, py, (0.2 + rand() * 0.7) * mm, (0.15 + rand() * 0.5) * mm, rand() * 3, 0, TAU);
    g.fill();
  }

  gr = g.createRadialGradient(fx, fy, 0, fx, fy, 3.2 * mm);
  gr.addColorStop(0, 'rgba(58,10,4,0.75)');
  gr.addColorStop(0.45, 'rgba(80,18,8,0.45)');
  gr.addColorStop(1, 'rgba(80,18,8,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(fx, fy, 3.2 * mm, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,230,190,0.85)';
  g.beginPath();
  g.arc(fx, fy, 0.09 * mm, 0, TAU);
  g.fill();

  // Retinal vessels: arcades leave the disc and curve around the macula.
  function vessel(x, y, ang, w, len, curl, col, depth) {
    g.strokeStyle = col;
    g.lineCap = 'round';
    const step = 0.22;
    for (let d = 0; d < len && w > 0.018; d += step) {
      const nx = x + Math.cos(ang) * step;
      const ny = y + Math.sin(ang) * step;
      g.lineWidth = w * mm;
      g.beginPath();
      g.moveTo(...P(x, y));
      g.lineTo(...P(nx, ny));
      g.stroke();
      x = nx;
      y = ny;
      const fr = Math.hypot(x, y);
      if (fr < 1.6) ang += Math.sign(Math.sin(ang) * x - Math.cos(ang) * y || 1) * 0.25;
      ang += curl * step + (rand() - 0.5) * 0.12;
      w *= 0.9975;
      if (depth < 4 && rand() < 0.03) {
        const side = rand() < 0.5 ? -1 : 1;
        vessel(x, y, ang + side * (0.45 + rand() * 0.6), w * 0.68, len * (0.35 + rand() * 0.3), curl * 0.3 + (rand() - 0.5) * 0.05, col, depth + 1);
        w *= 0.9;
      }
    }
  }
  const arcades = [
    [1.72, 0.105], [-1.72, -0.105], [0.8, -0.02], [-0.8, 0.02], [2.6, 0.03], [-2.6, -0.03], [0.1, 0.0],
  ];
  // veins (dark, wide) then arteries (lighter, narrower)
  for (const [col, w0, off] of [['#5a0c10', 0.16, 0.12], ['#b8291e', 0.11, -0.12]]) {
    for (const [a, curl] of arcades) vessel(disc[0], disc[1] + off * 0.6, a + off, w0, 26, curl, col, 0);
  }
  [fx, fy] = P(disc[0], disc[1]);
  gr = g.createRadialGradient(fx, fy, 0, fx, fy, 0.95 * mm);
  gr.addColorStop(0, '#fff4dc');
  gr.addColorStop(0.35, '#ffe0a8');
  gr.addColorStop(0.8, '#eaa06a');
  gr.addColorStop(1, 'rgba(210,110,60,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(fx, fy, 0.86 * mm, 0.96 * mm, 0, 0, TAU);
  g.fill();
  for (const [a, col, w] of [[1.5, '#6a1014', 0.13], [-1.5, '#6a1014', 0.13], [1.7, '#c0302a', 0.09], [-1.7, '#c0302a', 0.09]]) {
    g.strokeStyle = col;
    g.lineWidth = w * mm;
    g.beginPath();
    g.moveTo(fx, fy);
    g.lineTo(...P(disc[0] + Math.cos(a) * 0.9, disc[1] + Math.sin(a) * 0.9));
    g.stroke();
  }
  return c;
}

function irisCanvas() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const span = 13;
  const k = S / span;
  const cx = S / 2;
  const rand = mulberry(11);
  let gr = g.createRadialGradient(cx, cx, 0.8 * k, cx, cx, 6.2 * k);
  gr.addColorStop(0, '#2a160b');
  gr.addColorStop(0.28, '#6b4122');
  gr.addColorStop(0.45, '#4f7a86');
  gr.addColorStop(0.8, '#35606f');
  gr.addColorStop(0.95, '#1b2a31');
  gr.addColorStop(1, '#0c1216');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const a = rand() * TAU;
    const r0 = 1.2 + rand() * 1.5;
    const r1 = 3.5 + rand() * 2.4;
    const hue = rand() < 0.3 ? `rgba(200,150,90,${0.12 + rand() * 0.2})` : `rgba(140,190,200,${0.08 + rand() * 0.18})`;
    g.strokeStyle = hue;
    g.lineWidth = 0.5 + rand() * 1.4;
    g.beginPath();
    const wob = (rand() - 0.5) * 0.25;
    g.moveTo(cx + Math.cos(a) * r0 * k, cx + Math.sin(a) * r0 * k);
    g.quadraticCurveTo(cx + Math.cos(a + wob) * (r0 + r1) * 0.5 * k, cx + Math.sin(a + wob) * (r0 + r1) * 0.5 * k, cx + Math.cos(a) * r1 * k, cx + Math.sin(a) * r1 * k);
    g.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const a = rand() * TAU;
    const r = 2.4 + rand() * 2.8;
    g.fillStyle = `rgba(10,14,16,${0.25 + rand() * 0.3})`;
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * r * k, cx + Math.sin(a) * r * k, (0.12 + rand() * 0.25) * k, (0.3 + rand() * 0.5) * k, a, 0, TAU);
    g.fill();
  }
  g.strokeStyle = 'rgba(210,160,100,0.5)';
  g.lineWidth = 0.35 * k;
  g.beginPath();
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * TAU;
    const r = (2.5 + Math.sin(a * 13) * 0.18 + Math.sin(a * 5) * 0.1) * k;
    g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  g.stroke();
  gr = g.createRadialGradient(cx, cx, 5.2 * k, cx, cx, 6.2 * k);
  gr.addColorStop(0, 'rgba(8,10,12,0)');
  gr.addColorStop(1, 'rgba(8,10,12,0.9)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

function scleraCanvas() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#efe9e1';
  g.fillRect(0, 0, S, S);
  const rand = mulberry(3);
  const k = S / 26;
  const cx = S / 2;
  for (let i = 0; i < 46; i++) {
    let a = rand() * TAU;
    let r = 11.5;
    let w = 0.9 + rand() * 1.2;
    g.strokeStyle = `rgba(190,50,50,${0.18 + rand() * 0.22})`;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * k, cx + Math.sin(a) * r * k);
    for (let s = 0; s < 18; s++) {
      r -= 0.28;
      a += (rand() - 0.5) * 0.06;
      g.lineWidth = w;
      g.lineTo(cx + Math.cos(a) * r * k, cx + Math.sin(a) * r * k);
      w *= 0.95;
      if (r < 6.3) break;
    }
    g.stroke();
  }
  return c;
}

let TEX = null;
export function textures() {
  if (TEX) return TEX;
  const mk = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  TEX = { fundus: mk(fundusCanvas()), iris: mk(irisCanvas()), sclera: mk(scleraCanvas()) };
  return TEX;
}

// ------------------------------------------------------------------ the eye
export class Eye {
  constructor(side) {
    this.side = side;
    this.nasal = -side;
    this.group = new THREE.Group();
    this.group.position.copy(eyeCenter(side));
    this.group.name = side === RIGHT ? 'rightEye' : 'leftEye';
    this.params = { cut: 0, accom: 0, pupil: 3.4, axial: 24, lensTint: 0 };
    const T = textures();
    this.mat = {
      sclera: new THREE.MeshPhysicalMaterial({ color: 0xd9d2c8, map: T.sclera, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.55, sheen: 0.2, sheenColor: new THREE.Color('#ffb4a0'), side: THREE.DoubleSide }),
      choroid: new THREE.MeshStandardMaterial({ color: 0x3b0d0b, roughness: 0.8, side: THREE.DoubleSide }),
      retina: new THREE.MeshStandardMaterial({ map: T.fundus, emissiveMap: T.fundus, emissive: 0xffffff, emissiveIntensity: 0.28, roughness: 0.6, side: THREE.DoubleSide }),
      cornea: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transmission: 1, thickness: 0.55, ior: 1.376, transparent: true, opacity: 1, clearcoat: 1, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
      iris: new THREE.MeshStandardMaterial({ map: T.iris, roughness: 0.75, side: THREE.DoubleSide }),
      lens: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 1, thickness: 3.6, ior: 1.42, attenuationColor: new THREE.Color('#fff2c8'), attenuationDistance: 30, transparent: true, side: THREE.DoubleSide }),
      ciliary: new THREE.MeshStandardMaterial({ color: 0x4a2418, roughness: 0.7, side: THREE.DoubleSide }),
      zonule: new THREE.LineBasicMaterial({ color: 0xd9c8b0, transparent: true, opacity: 0.35 }),
    };
    this.meshes = {};
    this.rebuild();
  }

  set(p) {
    let dirty = false;
    for (const k in p) {
      if (Math.abs((this.params[k] ?? 0) - p[k]) > 1e-4) {
        this.params[k] = p[k];
        dirty = true;
      }
    }
    if (dirty) this.rebuild();
  }

  stretch() {
    return (this.params.axial - G.apex) / G.retinaR;
  }

  rebuild() {
    const { cut, accom, pupil } = this.params;
    const k = this.stretch();
    const n = this.nasal;
    for (const m of Object.values(this.meshes)) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes = {};
    const add = (name, geo, mat, order = 0) => {
      const m = name === 'zonules' ? new THREE.LineSegments(geo, mat) : new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      m.castShadow = false;
      this.meshes[name] = m;
      this.group.add(m);
      return m;
    };
    const unstretch = (v) => (v.z < 0 ? v.z / k : v.z);

    const thLimbus = Math.acos(-G.limbusZ / G.R);
    add('sclera', lathe(arc(G.R, 0, thLimbus, 80, k), cut, 96, (v) => [0.5 + v.x / 26, 0.5 + v.y / 26]), this.mat.sclera);

    const thOra = Math.acos(-4.9 / G.choroidR);
    add('choroid', lathe(arc(G.choroidR, 0, thOra, 64, k), cut, 96), this.mat.choroid);
    add('retina', lathe(arc(G.retinaR, 0, Math.acos(-4.9 / G.retinaR), 72, k), cut, 128, (v) => {
      const z = unstretch(v);
      const r = Math.hypot(v.x, v.y, z);
      const th = Math.acos(THREE.MathUtils.clamp(-z / r, -1, 1));
      const h = Math.hypot(v.x, v.y) || 1;
      const xm = (th * G.retinaR * v.x * n) / h;
      const ym = (th * G.retinaR * v.y) / h;
      return [0.5 + xm / (2 * FUNDUS_HALF), 0.5 + ym / (2 * FUNDUS_HALF)];
    }), this.mat.retina);

    // cornea: anterior surface (r 7.8) then posterior surface (r 6.5)
    const c1 = G.apex - 7.8;
    const c2 = G.apex - 0.55 - 6.5;
    const outer = capArc(7.8, c1, G.apex, G.limbusZ, 24);
    const innerEdgeZ = c2 + Math.sqrt(6.5 * 6.5 - 5.55 * 5.55);
    const inner = capArc(6.5, c2, innerEdgeZ, G.apex - 0.55, 24);
    add('cornea', lathe([...outer, ...inner], cut, 96), this.mat.cornea, 3);

    // iris: a slightly conical annulus resting on the lens
    const rp = pupil / 2;
    const irisPts = [
      new THREE.Vector2(rp, IRIS_Z + 0.05),
      new THREE.Vector2(rp + (5.9 - rp) * 0.35, IRIS_Z + 0.22),
      new THREE.Vector2(5.95, IRIS_Z - 0.35),
      new THREE.Vector2(5.9, IRIS_Z - 0.75),
      new THREE.Vector2(rp + 0.15, IRIS_Z - 0.3),
      new THREE.Vector2(rp, IRIS_Z + 0.05),
    ];
    add('iris', lathe(irisPts, cut, 96, (v) => [0.5 + v.x / 13, 0.5 + v.y / 13]), this.mat.iris, 1);

    const L = lensShape(accom);
    const lensPts = [...capArc(L.Rf, L.cf, L.zf, L.zEq, 22), ...capArc(L.Rb, L.cb, L.zEq, L.zb, 22)];
    this.mat.lens.thickness = L.zf - L.zb;
    add('lens', lathe(lensPts, cut, 96), this.mat.lens, 2);

    const cil = [
      new THREE.Vector2(5.95, IRIS_Z - 0.6),
      new THREE.Vector2(7.2, 8.6),
      new THREE.Vector2(8.9, 7.0),
      new THREE.Vector2(10.05, 4.9),
      new THREE.Vector2(9.4, 5.4),
      new THREE.Vector2(7.6 - 0.5 * accom, 6.9),
      new THREE.Vector2(6.6 - 0.4 * accom, 7.9),
      new THREE.Vector2(5.95, IRIS_Z - 0.6),
    ];
    add('ciliary', lathe(cil, cut, 96), this.mat.ciliary);

    const zp = [];
    const count = 90;
    for (let i = 0; i < count; i++) {
      const phi = Math.PI * (1 + cut) + TAU * (1 - cut) * (i / count);
      const sx = Math.sin(phi);
      const sy = -Math.cos(phi);
      const r0 = 7.4 - 0.5 * accom;
      for (const dz of [-0.5, 0.5]) {
        zp.push(sx * r0, sy * r0, 7.2 + dz * 0.6, sx * L.rEq, sy * L.rEq, L.zEq + dz * 0.8);
      }
    }
    const zg = new THREE.BufferGeometry();
    zg.setAttribute('position', new THREE.Float32BufferAttribute(zp, 3));
    add('zonules', zg, this.mat.zonule);
  }
}

// ------------------------------------------------------------------ ghost material (fresnel shell)
export function ghostMaterial(color, alpha = 0.12, power = 2.2) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uPow: { value: power } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vV=-mv.xyz; vN=normalMatrix*normal; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; uniform float uPow;
      varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0-abs(dot(normalize(vN),normalize(vV))), uPow); gl_FragColor = vec4(uColor*(0.35+f), uAlpha*(0.15+f)); }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// Very rough brain: two displaced ellipsoids with gyral noise. Only a context ghost.
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let a = 0; a < 2; a++)
    for (let b = 0; b < 2; b++)
      for (let c = 0; c < 2; c++) {
        r += hash3(xi + a, yi + b, zi + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
      }
  return r;
}

export function brainGhost() {
  const group = new THREE.Group();
  const mat = ghostMaterial('#8fa7c9', 0.1, 2.4);
  for (const h of [-1, 1]) {
    const geo = new THREE.SphereGeometry(1, 120, 80);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let x = v.x * 34, y = v.y * 50, z = v.z * 84;
      // flatten the medial wall
      if (x * h < 0) x *= 0.94;
      // orbital surface of the frontal lobe sits above the orbits
      if (y < 0) {
        const zz = z;
        const temporal = Math.exp(-(((zz + 10) / 34) ** 2));
        const frontal = zz > 30 ? 0.35 : 1;
        y *= 0.55 * frontal + 0.6 * temporal * (x * h > -4 ? 1 : 0.3);
      }
      const nz = vnoise(x * 0.11 + h * 5, y * 0.11, z * 0.11) * 2 + vnoise(x * 0.23, y * 0.23, z * 0.23);
      const len = Math.hypot(x, y, z) || 1;
      const d = (nz - 1.4) * 1.6;
      x += (x / len) * d;
      y += (y / len) * d;
      z += (z / len) * d;
      p.setXYZ(i, x + h * 34, y + 30, z - 86);
    }
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, mat));
  }
  const stemPts = [new THREE.Vector3(0, 8, -84), new THREE.Vector3(0, -6, -94), new THREE.Vector3(0, -26, -100), new THREE.Vector3(0, -48, -104), new THREE.Vector3(0, -70, -106)];
  const stem = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stemPts), 40, 1, 32, false);
  const sp = stem.attributes.position;
  // TubeGeometry radius 1 → scale radially per ring for midbrain / pons / medulla
  const rings = 41;
  const perRing = sp.count / rings;
  const curve = new THREE.CatmullRomCurve3(stemPts);
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < sp.count; i++) {
    const t = Math.floor(i / perRing) / (rings - 1);
    curve.getPointAt(t, c);
    const r = 10 + 5 * Math.exp(-(((t - 0.38) / 0.16) ** 2)) - 3 * t;
    v.fromBufferAttribute(sp, i).sub(c).multiplyScalar(r).add(c);
    sp.setXYZ(i, v.x, v.y, v.z);
  }
  stem.computeVertexNormals();
  const stemMesh = new THREE.Mesh(stem, ghostMaterial('#9fb4d6', 0.12, 2));
  group.add(stemMesh);
  group.userData.stem = stemMesh;
  return group;
}

export function orbitGhost(side) {
  const n = -side;
  const E = eyeCenter(side);
  const apex = new THREE.Vector3(13 * n, 2, -36).add(E);
  const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 10, true);
  const p = geo.attributes.position;
  const w = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    w.fromBufferAttribute(p, i);
    const t = w.y + 0.5; // 0 apex → 1 rim
    const a = Math.atan2(w.z, w.x);
    const rim = new THREE.Vector3(E.x + Math.cos(a) * 21 - n * 1, E.y + 1 + Math.sin(a) * 18, 10);
    const s = Math.pow(t, 0.8);
    p.setXYZ(i, apex.x + (rim.x - apex.x) * s, apex.y + (rim.y - apex.y) * s, apex.z + (rim.z - apex.z) * t);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, ghostMaterial('#b7c4d8', 0.07, 1.6));
}
