import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

import { Eye, RIGHT, LEFT, SIDES, eyeCenter, G, DISC, retinaLocal, brainGhost, orbitGhost, toonRamp } from './anatomy.js';
import { solveOptics, rayBundles, SPECTACLE_T } from './optics.js';
import { Oculomotor, GazeController, listingQuat, MUSCLE_DEFS } from './muscles.js';
import { Pathway, skinUniforms, lesionPresets, glowTexture } from './pathway.js';
import { drawField, drawDiplopia, Traces, drawMainSequence, drawRetinalImage } from './ui.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const fmt = (v, d = 1) => (v < -0.5 * 10 ** -d ? '−' : '') + Math.abs(v).toFixed(d);
const sgn = (v, d = 1) => (v > 0.5 * 10 ** -d ? '+' : '') + fmt(v, d);
const azOf = (d) => Math.atan2(-d.x, d.z) / DEG; // + = subject's right
const elOf = (d) => Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / DEG;
const dirFrom = (az, el) => new THREE.Vector3(-Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), Math.cos(az * DEG) * Math.cos(el * DEG));
const key = (s) => (s === RIGHT ? 'R' : 'L');

// ============================================================ renderer / scene
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setClearColor(0x09110f, 1);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(-120, 90, 160);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 20;
controls.maxDistance = 700;

scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(2500, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: 'varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vW; void main(){
      float up = vW.y*0.5+0.5;
      vec3 c = mix(vec3(0.025,0.045,0.038), vec3(0.055,0.085,0.067), smoothstep(0.2,1.0,up));
      c += vec3(0.12,0.16,0.065) * pow(max(0.0, dot(vW, normalize(vec3(-0.4,0.3,0.6)))), 8.0);
      gl_FragColor = vec4(c,1.); }`,
  }),
));
scene.add(new THREE.HemisphereLight(0xe5edcf, 0x18231c, 0.8));
const key1 = new THREE.DirectionalLight(0xfff0cb, 2.0);
key1.position.set(-120, 200, 180);
scene.add(key1);
const rim = new THREE.DirectionalLight(0xc4e879, 1.0);
rim.position.set(160, 60, -200);
scene.add(rim);

// ============================================================ post
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ============================================================ anatomy
const eyes = { [RIGHT]: new Eye(RIGHT), [LEFT]: new Eye(LEFT) };
for (const s of SIDES) scene.add(eyes[s].group);
const pupilLamp = new THREE.Group();
const pupilBeam = new THREE.Mesh(
  new THREE.ConeGeometry(3.8, 20, 24, 1),
  new THREE.MeshBasicMaterial({ color: 0xd4f06d, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
);
pupilBeam.geometry.rotateX(-Math.PI / 2); // cone tip points from the light toward the eye
pupilBeam.position.z = 19.2;
const pupilEmitter = new THREE.Mesh(
  new THREE.SphereGeometry(1.15, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xf1ffbb, toneMapped: false }),
);
pupilEmitter.position.z = 32;
pupilLamp.add(pupilBeam, pupilEmitter);
scene.add(pupilLamp);

const brain = brainGhost();
scene.add(brain);
const orbits = new THREE.Group();
for (const s of SIDES) orbits.add(orbitGhost(s));
scene.add(orbits);

const path = new Pathway();
scene.add(path.world);
for (const s of SIDES) eyes[s].group.add(path.intra[s]);

// ============================================================ muscles
const oc = { [RIGHT]: new Oculomotor(RIGHT), [LEFT]: new Oculomotor(LEFT) };
const gaze = new GazeController();
const TENDON = { MR: 3.7, LR: 8.8, SR: 5.8, IR: 5.5, SO: 0, IO: 1.5 };
const RED = new THREE.Color('#a8322b');
const WHITE = new THREE.Color('#e9e2d4');

class Ribbon {
  constructor(m) {
    this.m = m;
    this.rings = 56;
    this.rad = 14;
    const n = this.rings * this.rad;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx = [];
    for (let i = 0; i < this.rings - 1; i++)
      for (let j = 0; j < this.rad; j++) {
        const a = i * this.rad + j, b = i * this.rad + ((j + 1) % this.rad);
        const c = a + this.rad, d = b + this.rad;
        idx.push(a, c, b, b, c, d);
      }
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(), emissive: 0x9c3328, emissiveIntensity: 0 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mid = new THREE.Vector3();
    this.tmp = [];
  }
  update(localPts, E, f, alive) {
    const pts = new THREE.CatmullRomCurve3(localPts, false, 'centripetal').getSpacedPoints(this.rings - 1);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = cum[cum.length - 1];
    // SO: everything after the trochlea is tendon
    let tendonLen = TENDON[this.m.id];
    if (this.m.trochlea) {
      let best = Infinity;
      pts.forEach((p, i) => {
        const d = p.distanceTo(this.m.P);
        if (d < best) { best = d; tendonLen = total - cum[i]; }
      });
    }
    const act = alive ? Math.max(0, f - 0.3) / 0.7 : 0;
    const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      T.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
      N.copy(p).addScaledVector(T, -p.dot(T)).normalize();
      B.crossVectors(T, N).normalize();
      const dO = cum[i], dI = total - cum[i];
      const tendon = THREE.MathUtils.smoothstep(tendonLen + 1.5 - dI, 0, 3);
      const orig = THREE.MathUtils.smoothstep(4 - dO, 0, 3);
      const b = THREE.MathUtils.clamp(dO / Math.max(total - tendonLen, 1), 0, 1);
      const swell = alive ? 1 + 0.6 * act : 0.7;
      let w = 3 + (this.m.width * 0.8 - 3) * Math.sin(Math.PI * Math.min(b * 0.9 + 0.05, 1));
      let th = (1.1 + 1.9 * Math.sin(Math.PI * b)) * swell;
      const tw = this.m.trochlea ? THREE.MathUtils.lerp(2.2, this.m.width, THREE.MathUtils.smoothstep(7 - dI, 0, 7)) : this.m.width;
      w = THREE.MathUtils.lerp(w, tw, tendon);
      th = THREE.MathUtils.lerp(th, 0.45, tendon);
      w = THREE.MathUtils.lerp(w, 2.4, orig);
      th = THREE.MathUtils.lerp(th, 0.9, orig);
      c.copy(alive ? RED : new THREE.Color('#5a3a3a')).lerp(WHITE, Math.max(tendon, orig * 0.7));
      for (let j = 0; j < this.rad; j++) {
        const a = (j / this.rad) * Math.PI * 2;
        const k = (i * this.rad + j) * 3;
        const x = p.x + B.x * Math.cos(a) * w * 0.5 + N.x * (Math.sin(a) + 1) * th * 0.5 + E.x;
        const y = p.y + B.y * Math.cos(a) * w * 0.5 + N.y * (Math.sin(a) + 1) * th * 0.5 + E.y;
        const z = p.z + B.z * Math.cos(a) * w * 0.5 + N.z * (Math.sin(a) + 1) * th * 0.5 + E.z;
        this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
        this.col[k] = c.r; this.col[k + 1] = c.g; this.col[k + 2] = c.b;
      }
      if (i === Math.round(pts.length * 0.42)) this.mid.copy(p).add(E);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.mat.emissiveIntensity = act * 1.4;
  }
}

const muscleGroup = new THREE.Group();
scene.add(muscleGroup);
const ribbons = {};
for (const s of SIDES) {
  ribbons[s] = oc[s].muscles.map((m) => {
    const r = new Ribbon(m);
    muscleGroup.add(r.mesh);
    return r;
  });
}
function updateRibbons() {
  for (const s of SIDES) {
    const o = oc[s];
    o.muscles.forEach((m, i) => ribbons[s][i].update(o.path(m, o.q), o.center, m.f, m.alive));
  }
}
// trochlea pulleys
for (const s of SIDES) {
  const so = oc[s].muscles.find((m) => m.id === 'SO');
  const t = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.55, 10, 24), new THREE.MeshToonMaterial({ color: 0xdcd3c2, gradientMap: toonRamp() }));
  t.position.copy(so.P).add(oc[s].center);
  t.lookAt(so.O.clone().add(oc[s].center));
  muscleGroup.add(t);
}

// ============================================================ cranial nerves (III, IV, VI)
const NERVE_COL = { III: '#7cf2a2', IV: '#ffd166', VI: '#76b8ff' };
function nerveMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uRate: { value: 100 }, uLen: { value: 100 }, uDead: { value: 0 } },
    vertexShader: 'varying float vU; void main(){ vU = uv.x; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uRate; uniform float uLen; uniform float uDead; varying float vU;
      void main(){
        float spacing = 1000.0 / max(uRate, 1.0);
        float ph = fract((vU*uLen - uTime*45.0) / spacing);
        float p = smoothstep(0.0,0.06,ph)*(1.0-smoothstep(0.06,0.3,ph));
        vec3 c = mix(uColor, vec3(1.0,0.25,0.25), uDead);
        float on = (1.0-uDead) * smoothstep(5.0, 60.0, uRate);
        gl_FragColor = vec4(c*(0.28 + p*2.2*on), 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
const nerveGroup = new THREE.Group();
scene.add(nerveGroup);
const nerves = []; // { side, nerve, muscles:[ids], mat }
const nuclei = [];
function restPoint(s, id, frac) {
  const o = oc[s];
  const m = o.muscles.find((x) => x.id === id);
  const pts = o.path(m, new THREE.Quaternion());
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return curve.getPointAt(frac).add(o.center);
}
function nerveTube(pts, s, nerve, muscles, r = 0.45) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const mat = nerveMaterial(NERVE_COL[nerve]);
  mat.uniforms.uLen.value = len;
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.round(len / 1.2), r, 8, false), mat);
  nerveGroup.add(mesh);
  nerves.push({ side: s, nerve, muscles, mat });
}
for (const s of SIDES) {
  const n = -s;
  const E = eyeCenter(s);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const SOF = E.clone().add(V(n * 9, 4, -31));
  const III = [V(s * 2.5, -4, -97), V(s * 4.5, -14, -86), V(s * 9, -10, -70), V(s * 14, -3, -55), SOF];
  nerveTube(III, s, 'III', ['MR', 'SR', 'IR', 'IO'], 0.6);
  const sup = SOF.clone().add(V(0, 2, 2));
  nerveTube([SOF, sup, restPoint(s, 'SR', 0.4)], s, 'III', ['SR']);
  nerveTube([SOF, SOF.clone().add(V(n * 1.5, -1.5, 3)), restPoint(s, 'MR', 0.38)], s, 'III', ['MR']);
  nerveTube([SOF, SOF.clone().add(V(0, -3, 3)), restPoint(s, 'IR', 0.38)], s, 'III', ['IR']);
  nerveTube([SOF, SOF.clone().add(V(n * 1, -5, 8)), restPoint(s, 'IR', 0.7).add(V(n * 2, -2, 0)), restPoint(s, 'IO', 0.45)], s, 'III', ['IO']);
  // IV leaves the back of the midbrain and crosses: its nucleus is on the opposite side
  const IV = [V(-s * 2.5, -9, -103), V(-s * 1.5, -6, -112), V(s * 2.5, -7, -114), V(s * 11, -10, -101), V(s * 13, -8, -80), V(s * 15, -3, -55), SOF.clone().add(V(0, 3, 0)), restPoint(s, 'SO', 0.3)];
  nerveTube(IV, s, 'IV', ['SO']);
  // VI: long course up the clivus — easily stretched by raised intracranial pressure
  const VI = [V(s * 4, -26, -104), V(s * 3.5, -36, -92), V(s * 8, -20, -76), V(s * 15, -6, -56), SOF.clone().add(V(-n * 1.5, 0, 0)), restPoint(s, 'LR', 0.35)];
  nerveTube(VI, s, 'VI', ['LR']);
  for (const [p, nerve] of [[III[0], 'III'], [IV[0], 'IV'], [VI[0], 'VI']]) {
    const nuc = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: NERVE_COL[nerve] }));
    nuc.position.copy(p);
    nerveGroup.add(nuc);
    nuclei.push({ side: nerve === 'IV' ? -s : s, nerve, mesh: nuc, pos: p.clone() });
  }
}

// ============================================================ gaze target + visual axes
const targetOrb = new THREE.Group();
{
  const core = new THREE.Mesh(new THREE.SphereGeometry(3.2, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff3cf }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd98a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.scale.set(30, 30, 1);
  targetOrb.add(core, halo);
}
scene.add(targetOrb);
const lasers = {};
for (const s of SIDES) {
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const col = new THREE.Color(s === RIGHT ? '#46d6ff' : '#ff5fae').multiplyScalar(1.6);
  lasers[s] = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  lasers[s].frustumCulled = false;
  scene.add(lasers[s]);
}

// ============================================================ optics rays
const rayGroup = new THREE.Group();
eyes[RIGHT].group.add(rayGroup);
const rayMats = [];
const specMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transmission: 1, thickness: 2, ior: 1.5, transparent: true, side: THREE.DoubleSide });
let specMesh = null;
const objMarkers = new THREE.Group();
rayGroup.add(objMarkers);

function lineMat(color, width, opacity) {
  const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  m.resolution.set(window.innerWidth, window.innerHeight);
  rayMats.push(m);
  return m;
}
const optics = { dist: Infinity, age: 25, axial: 24, pupil: 4, spec: false, offAxis: true, res: null };
const pupilLab = { lightEye: RIGHT, intensity: 45, defect: 'none', diameters: { [RIGHT]: 4, [LEFT]: 4 } };

function rebuildRays() {
  for (const c of [...rayGroup.children]) if (c !== objMarkers) { rayGroup.remove(c); c.geometry?.dispose(); }
  objMarkers.clear();
  rayMats.length = 0;
  const res = optics.res;
  const bundles = rayBundles(optics.dist, res.state, optics.offAxis);
  const toLocal = (p, rot) => [p.h * Math.cos(rot), p.h * Math.sin(rot), G.apex - p.t];
  const cols = { axial: new THREE.Color('#ffc94d').multiplyScalar(1.15), field: new THREE.Color('#b99cff').multiplyScalar(1.1) };
  for (const B of bundles) {
    const rots = B.kind === 'axial' ? [0, -0.5, -1.0, -1.5708] : [0];
    rots.forEach((rot, ri) => {
      for (const r of B.rays) {
        if (ri > 0 && r.blocked) continue;
        const pos = r.pts.flatMap((p) => toLocal(p, rot));
        const g = new LineGeometry();
        g.setPositions(pos);
        const main = ri === 0;
        const l = new Line2(g, lineMat(cols[B.kind], main ? (r.blocked ? 1 : 1.8) : 1, main ? (r.blocked ? 0.25 : 0.95) : 0.22));
        l.computeLineDistances();
        rayGroup.add(l);
      }
    });
    // focus spot on the retina
    const hits = B.rays.filter((r) => r.retina).map((r) => r.retina);
    if (hits.length) {
      const avg = hits.reduce((a, p) => a + p.h, 0) / hits.length;
      const t = hits.reduce((a, p) => a + p.t, 0) / hits.length;
      const spot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: cols[B.kind], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      const size = 1.2 + res.blur * 2;
      spot.scale.set(size, size, 1);
      spot.position.set(avg, 0, G.apex - t);
      objMarkers.add(spot);
    }
  }
  if (Number.isFinite(optics.dist) && optics.dist <= 140) {
    for (const [h, col] of [[0, '#ffe3a0'], ...(optics.offAxis ? [[optics.dist * Math.tan(9 * DEG), '#d7c6ff']] : [])]) {
      const o = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshBasicMaterial({ color: col }));
      o.position.set(h, 0, G.apex + optics.dist);
      objMarkers.add(o);
    }
  }
  if (specMesh) { rayGroup.remove(specMesh); specMesh.geometry.dispose(); specMesh = null; }
  if (res.spec) {
    // meniscus-ish lens: thicker edge for minus, thicker centre for plus
    const P = res.spec;
    const pts = [];
    const R = 17;
    for (let i = 0; i <= 20; i++) {
      const r = (i / 20) * R;
      const sag = (P * r * r) / 2000 / 1.5 * 0.9;
      pts.push(new THREE.Vector2(Math.max(r, 1e-3), 1.2 + Math.max(0, sag) + (P < 0 ? -sag * 0.2 : 0)));
    }
    for (let i = 20; i >= 0; i--) {
      const r = (i / 20) * R;
      const sag = (P * r * r) / 2000 / 1.5 * 0.9;
      pts.push(new THREE.Vector2(Math.max(r, 1e-3), -1.2 - Math.max(0, sag) + (P < 0 ? sag * 1.2 : 0)));
    }
    const g = new THREE.LatheGeometry(pts, 64);
    g.rotateX(Math.PI / 2);
    specMesh = new THREE.Mesh(g, specMat);
    specMesh.position.z = G.apex - SPECTACLE_T;
    rayGroup.add(specMesh);
  }
}

// ============================================================ labels
const labelHost = $('labels');
let labels = [];
function setLabels(list) {
  labelHost.innerHTML = '';
  labels = list.map((l) => {
    const d = document.createElement('div');
    d.className = 'tag3d ' + (l.cls || '');
    d.innerHTML = `<i></i>${l.text}`;
    labelHost.appendChild(d);
    return { ...l, el: d };
  });
}
const _v = new THREE.Vector3();
let showLabels = true;
try { showLabels = localStorage.getItem('eyesim.labels') !== 'off'; } catch {}
function setShowLabels(on) {
  showLabels = on;
  document.body.classList.toggle('nolabels', !on);
  $('labelBtn').classList.toggle('on', on);
  $('labelBtn').setAttribute('aria-pressed', String(on));
  try { localStorage.setItem('eyesim.labels', on ? 'on' : 'off'); } catch {}
}
$('labelBtn').addEventListener('click', () => setShowLabels(!showLabels));
window.addEventListener('keydown', (e) => {
  if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !/input|textarea/i.test(e.target.tagName)) setShowLabels(!showLabels);
});
setShowLabels(showLabels);
function placeLabels() {
  if (!showLabels) return;
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of labels) {
    const p = typeof l.pos === 'function' ? l.pos() : l.pos;
    _v.copy(p).project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
      l.el.style.opacity = 0;
      continue;
    }
    l.el.style.opacity = '';
    l.el.style.transform = `translate(${((_v.x + 1) / 2) * w + 8}px, ${((1 - _v.y) / 2) * h - 10}px)`;
  }
}
const ER = eyeCenter(RIGHT);
const eyeLocal = (s, x, y, z) => () => new THREE.Vector3(x, y, z).applyQuaternion(eyes[s].group.quaternion).add(eyes[s].group.position);
const LABELS = {
  optics: [
    { text: 'Cornea · ~43 D', pos: eyeLocal(RIGHT, -5.2, 0, 11.6) },
    { text: 'Iris', pos: eyeLocal(RIGHT, -5.8, 0, 9.4) },
    { text: 'Lens · ~20 D + accommodation', pos: eyeLocal(RIGHT, -3.2, 0, 7.2) },
    { text: 'Ciliary muscle', pos: eyeLocal(RIGHT, -8.6, 0, 6.8) },
    { text: 'Retina', pos: eyeLocal(RIGHT, -9.6, 0, -5) },
    { text: 'Fovea', pos: eyeLocal(RIGHT, 0, 0, -11.2), cls: 'ray' },
    { text: 'Optic disc (blind spot)', pos: () => retinaLocal(DISC.x, DISC.y, 1).applyQuaternion(eyes[RIGHT].group.quaternion).add(ER) },
    { text: 'Right pupil · 4.0 mm', pos: eyeLocal(RIGHT, 0, 0, 9.5), cls: 'pupilR' },
    { text: 'Left pupil · 4.0 mm', pos: eyeLocal(LEFT, 0, 0, 9.5), cls: 'pupilL' },
  ],
  motor: [],
  wiring: [],
};
function motorLabels() {
  const list = ribbons[RIGHT].map((r) => ({ text: `${r.m.id} · ${r.m.name.toLowerCase()}`, pos: () => r.mid, cls: 'm' }));
  list.push({ text: 'Trochlea', pos: oc[RIGHT].muscles.find((m) => m.id === 'SO').P.clone().add(ER), cls: 'dim' });
  for (const nu of nuclei.filter((x) => x.side === LEFT)) list.push({ text: `CN ${nu.nerve} nucleus`, pos: nu.pos, cls: 'n' });
  list.push({ text: 'Brainstem', pos: new THREE.Vector3(0, -40, -104), cls: 'dim' });
  return list;
}
LABELS.wiring = [
  { text: 'Optic nerve', pos: path.anchors.nerve, cls: 'r' },
  { text: 'Optic chiasm', pos: path.anchors.chiasm, cls: 'v' },
  { text: 'Optic tract', pos: path.anchors.tract, cls: 'v' },
  { text: 'LGN · 6 layers', pos: path.anchors.lgn, cls: 'v' },
  { text: "Meyer's loop", pos: path.anchors.meyer, cls: 'ray' },
  { text: 'Optic radiation', pos: path.anchors.radiation, cls: 'ray' },
  { text: 'V1 · calcarine cortex', pos: path.anchors.v1, cls: 'ray' },
  { text: 'Retinal nerve fibre layer', pos: path.anchors.retina, cls: 'l' },
];

// ============================================================ modes
const MODES = {
  optics: {
    eyebrow: '01 · Optics',
    title: 'Focus',
    lede: 'Follow light from the cornea to the <b>retina</b>. Change distance, age and pupil size to see how accommodation and refractive error alter the image that reaches the fovea.',
    cam: { pos: [-45, 84, 2], target: [-31, 0, 2] },
    hint: 'Drag to orbit · scroll to zoom',
  },
  motor: {
    eyebrow: '02 · Movement',
    title: 'Six muscles, three nerves',
    lede: 'Six muscles steer each eye, coordinated by cranial nerves <b>III, IV and VI</b>. Track pursuit and saccades, then interrupt a nerve to see how alignment and double vision change.',
    cam: { pos: [-128, 92, 150], target: [0, -8, -24] },
    hint: 'Move your pointer: both eyes look at it',
  },
  wiring: {
    eyebrow: '03 · Wiring',
    title: 'Retina to cortex',
    lede: 'Trace a visual signal from retina through the <b>optic chiasm</b>, thalamic LGN and optic radiations to V1 in the occipital lobe. Lesions reveal how anatomy predicts blind areas in the visual field.',
    cam: { pos: [26, 390, -168], target: [26, -10, -88] },
    hint: 'Drag on a field chart to move the probe',
  },
};
let mode = 'optics';
let tween = null;
function setMode(m, instant = false) {
  mode = m;
  document.body.dataset.mode = m;
  const M = MODES[m];
  $('eyebrow').textContent = M.eyebrow;
  $('title').textContent = M.title;
  $('lede').innerHTML = M.lede;
  $('hint').textContent = M.hint;
  document.querySelectorAll('#modes button[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  document.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== m));

  const optics_ = m === 'optics', motor = m === 'motor', wiring = m === 'wiring';
  eyes[RIGHT].set({ cut: optics_ || wiring ? 0.5 : 0 });
  eyes[LEFT].set({ cut: wiring ? 0.5 : 0 });
  rayGroup.visible = optics_;
  pupilLamp.visible = optics_ && pupilLab.intensity > 0;
  muscleGroup.visible = motor;
  nerveGroup.visible = motor;
  orbits.visible = motor;
  targetOrb.visible = motor;
  for (const s of SIDES) lasers[s].visible = motor;
  brain.visible = motor || wiring;
  brain.children.forEach((c) => (c.visible = c === brain.userData.stem ? motor : wiring));
  path.world.visible = wiring || motor;
  for (const c of path.world.children) c.visible = wiring;
  path.sheaths.visible = true;
  path.sheaths.children.forEach((c) => (c.visible = wiring || c.name === 'optic nerve'));
  for (const s of SIDES) path.intra[s].visible = wiring;
  controls.autoRotate = false;

  setLabels(m === 'motor' ? motorLabels() : LABELS[m]);
  if (m === 'optics') updateOptics();
  if (m === 'wiring') applyLesion(currentLesion);

  const from = { pos: camera.position.clone(), target: controls.target.clone() };
  const to = { pos: new THREE.Vector3(...M.cam.pos), target: new THREE.Vector3(...M.cam.target) };
  if (instant) {
    camera.position.copy(to.pos);
    controls.target.copy(to.target);
  } else tween = { from, to, t: 0 };
  refreshChips();
}
document.querySelectorAll('#modes button[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ============================================================ chips
function chips(list) {
  $('chips').innerHTML = list.map((c) => `<div class="chip ${c.cls || ''}"><label>${c.label}</label><b id="${c.id}">${c.value ?? '—'}</b></div>`).join('');
}
function refreshChips() {
  if (mode === 'optics') {
    const r = optics.res;
    const rxTxt = Math.abs(r.rx) < 0.25 ? 'none' : `${sgn(r.rx, 2)}<small>D</small>`;
    chips([
      { label: 'Accommodation', value: `${fmt(r.used, 1)}<small>/ ${fmt(r.amp, 1)} D</small>`, cls: r.used > r.amp - 0.05 && r.blurArcmin > 2 ? 'warn' : '' },
      { label: 'Refractive error', value: rxTxt },
      { label: 'Blur on retina', value: `${fmt(r.blur * 1000, 0)}<small>µm</small>`, cls: r.blurArcmin > 2 ? 'warn' : 'ray' },
    ]);
  } else if (mode === 'motor') {
    chips([
      { label: 'Right eye', id: 'cR', cls: 'r' },
      { label: 'Left eye', id: 'cL', cls: 'l' },
      { label: 'Vergence', id: 'cV' },
      { label: 'Deviation', id: 'cD' },
    ]);
  } else {
    chips([
      { label: 'Axons modelled', value: `${path.fibers.length}` },
      { label: 'Cross at chiasm', value: `${Math.round((100 * path.fibers.filter((f) => f.crossed).length) / path.fibers.length)}<small>%</small>` },
      { label: 'Axons cut', id: 'cCut', value: '0' },
    ]);
  }
}

// ============================================================ optics UI
const sliderFill = (el) => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
const distOf = (v) => (v >= 100 ? Infinity : 100 * Math.pow(60, v / 99));
const distTxt = (d) => (!Number.isFinite(d) ? '∞ (distant)' : d < 1000 ? `${Math.round(d / 10)} cm` : `${(d / 1000).toFixed(1)} m`);
function updatePupilLab() {
  const dark = +$('pupil').value / 10;
  const strength = THREE.MathUtils.smoothstep(pupilLab.intensity / 100, 0.03, 0.92);
  const afferentSide = pupilLab.defect.endsWith('-aff') ? (pupilLab.defect.startsWith('r') ? RIGHT : LEFT) : null;
  const efferentSide = pupilLab.defect.endsWith('-eff') ? (pupilLab.defect.startsWith('r') ? RIGHT : LEFT) : null;
  const afferentBlocked = afferentSide === pupilLab.lightEye;
  for (const side of SIDES) {
    if (side === efferentSide) pupilLab.diameters[side] = 7.5; // a denervated pupil is large and fixed
    else if (afferentBlocked) pupilLab.diameters[side] = dark;
    else pupilLab.diameters[side] = dark - (dark - 2.1) * strength;
  }
  $('lightOut').textContent = `${pupilLab.intensity}%`;
  $('pupilRightOut').textContent = `${pupilLab.diameters[RIGHT].toFixed(1)} mm · ${pupilLab.lightEye === RIGHT ? 'direct' : 'consensual'}`;
  $('pupilLeftOut').textContent = `${pupilLab.diameters[LEFT].toFixed(1)} mm · ${pupilLab.lightEye === LEFT ? 'direct' : 'consensual'}`;
  sliderFill($('lightLevel'));
  $('pupilStateOut').textContent = pupilLab.defect === 'none' ? 'Direct + consensual' : pupilLab.defect.endsWith('-aff') ? 'Afferent pathway' : 'Efferent pathway';
  let note;
  if (afferentBlocked) {
    note = `Light enters the ${pupilLab.lightEye === RIGHT ? 'right' : 'left'} eye, but its <b>CN II afferent signal is interrupted</b>. Neither pupil receives the light command. Illuminate the other eye to compare.`;
  } else if (efferentSide !== null) {
    note = `The ${efferentSide === RIGHT ? 'right' : 'left'} pupil is <b>dilated and fixed</b>: its CN III output cannot constrict it. The fellow pupil still responds to light in either eye.`;
  } else if (pupilLab.intensity < 4) {
    note = 'In dim light, both pupils relax toward their dark-adapted size. Raise the light to trigger direct and consensual constriction.';
  } else {
    note = `Light in the ${pupilLab.lightEye === RIGHT ? 'right' : 'left'} eye constricts that pupil directly and the fellow pupil consensually. Bilateral output follows input from either eye.`;
  }
  $('pupilNote').innerHTML = note;
  const lampPosition = eyeCenter(pupilLab.lightEye);
  pupilLamp.position.set(lampPosition.x, 0, 0);
  pupilLamp.visible = mode === 'optics' && pupilLab.intensity > 0;
  pupilBeam.material.opacity = 0.035 + (pupilLab.intensity / 100) * 0.19;
  for (const [cls, side, name] of [['pupilR', RIGHT, 'Right'], ['pupilL', LEFT, 'Left']]) {
    const label = labels.find((l) => l.cls === cls);
    if (label) label.el.lastChild.textContent = `${name} pupil · ${pupilLab.diameters[side].toFixed(1)} mm · ${side === pupilLab.lightEye ? 'direct' : 'consensual'}`;
  }
}
document.querySelectorAll('#lightEyeSeg button').forEach((b) => b.addEventListener('click', () => {
  pupilLab.lightEye = +b.dataset.eye;
  document.querySelectorAll('#lightEyeSeg button').forEach((x) => x.classList.toggle('on', x === b));
  updateOptics();
}));
$('lightLevel').addEventListener('input', () => { pupilLab.intensity = +$('lightLevel').value; updateOptics(); });
$('pupilDefect').addEventListener('change', () => { pupilLab.defect = $('pupilDefect').value; updateOptics(); });
function readOptics() {
  optics.dist = distOf(+$('dist').value);
  optics.age = +$('age').value;
  optics.axial = +$('axial').value / 100;
  optics.pupil = pupilLab.diameters[RIGHT];
  optics.spec = $('spec').checked;
  optics.offAxis = $('offaxis').checked;
}
function updateOptics() {
  updatePupilLab();
  readOptics();
  $('distOut').textContent = distTxt(optics.dist);
  $('ageOut').textContent = `${optics.age} y`;
  $('axialOut').textContent = `${optics.axial.toFixed(1)} mm`;
  $('pupilOut').textContent = `${(+$('pupil').value / 10).toFixed(1)} mm dark`;
  for (const id of ['dist', 'age', 'axial', 'pupil']) sliderFill($(id));
  const res = solveOptics({ objDist: optics.dist, age: optics.age, axial: optics.axial, pupil: optics.pupil, correct: optics.spec });
  optics.res = res;
  const tint = THREE.MathUtils.clamp((optics.age - 35) / 40, 0, 1);
  eyes[RIGHT].set({ accom: res.A, pupil: optics.pupil, axial: optics.axial });
  eyes[LEFT].set({ pupil: pupilLab.diameters[LEFT] });
  eyes[RIGHT].mat.lens.attenuationColor.set('#fff6dc').lerp(new THREE.Color('#e0a93a'), tint);
  eyes[RIGHT].mat.lens.attenuationDistance = 30 - 24 * tint;
  rebuildRays();
  $('blurOut').textContent = `blur ${fmt(res.blurArcmin, 1)}′`;
  drawRetinalImage($('retImg'), res.blurArcmin, tint);
  const need = Number.isFinite(optics.dist) ? 1000 / optics.dist : 0;
  let note;
  const rx = res.rx;
  const neededTotal = need - (optics.spec ? 0 : rx); // hyperopes must accommodate extra, myopes less
  if (res.blurArcmin < 1.5) {
    note = res.used > 0.1
      ? `Sharp. The ciliary muscle has contracted and the lens has rounded, adding <b>${fmt(res.used, 1)} D</b> of power.`
      : `Sharp with the lens fully relaxed. The cornea does about two-thirds of the focusing and the lens the rest.`;
    if (optics.spec && Math.abs(rx) > 0.25) note += ` The <b>${sgn(res.spec, 2)} D</b> spectacle lens moves the eye's far point back to infinity.`;
  } else if (res.used >= res.amp - 0.05 && neededTotal > res.amp) {
    note = `Out of range. Focusing here needs <b>${fmt(neededTotal, 1)} D</b> of accommodation, but at ${optics.age} the lens can supply only <b>${fmt(res.amp, 1)} D</b>. `
      + (optics.age >= 45 ? 'This is <b>presbyopia</b>: the lens has stiffened and no longer rounds up. Reading glasses add the missing power.' : 'A hyperopic eye spends its accommodation on distance vision, so it runs out sooner at near.');
  } else if (rx < -0.25) {
    note = `The eye is too long for its power, so light focuses <b>in front of</b> the retina (myopia). Relaxing the lens is the most it can do, and it cannot remove power. The far point is ${fmt(1000 / -rx / 10, 0)} cm away. Tick “Prescribe glasses” to add a ${sgn(rx, 2)} D lens.`;
  } else note = `The image is out of focus: blur disc ${fmt(res.blur * 1000, 0)} µm on the retina.`;
  $('opticsFoot').innerHTML = note;
  refreshChips();
}
for (const id of ['dist', 'age', 'axial', 'pupil']) $(id).addEventListener('input', updateOptics);
for (const id of ['spec', 'offaxis']) $(id).addEventListener('change', updateOptics);
const OPTICS_PRESETS = {
  young: { dist: 30, age: 16, axial: 2400, pupil: 40, spec: false },
  myope: { dist: 100, age: 25, axial: 2550, pupil: 50, spec: false },
  hyper: { dist: 40, age: 35, axial: 2300, pupil: 40, spec: false },
  presby: { dist: 30, age: 60, axial: 2400, pupil: 30, spec: false },
};
document.querySelectorAll('#opticsPresets button').forEach((b) =>
  b.addEventListener('click', () => {
    const p = OPTICS_PRESETS[b.dataset.p];
    for (const k of ['dist', 'age', 'axial', 'pupil']) $(k).value = p[k];
    $('spec').checked = p.spec;
    document.querySelectorAll('#opticsPresets button').forEach((x) => x.classList.toggle('on', x === b));
    updateOptics();
  }),
);

// ============================================================ motor UI
const motor = { exp: 'follow', dist: 400, freq: 0.4, pointer: null, seq: [], sacc: null, lastJump: 0, jumpTarget: [0, 0] };
document.querySelectorAll('#expSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    motor.exp = b.dataset.x;
    document.querySelectorAll('#expSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $('freqCtl').hidden = motor.exp !== 'pursuit';
    $('distCtl').hidden = motor.exp === 'verge';
    $('traceCap').textContent = motor.exp === 'saccade' ? 'Main sequence' : 'Eye position';
    motor.t0 = clock;
  }),
);
$('tdist').addEventListener('input', () => {
  motor.dist = +$('tdist').value;
  $('tdOut').textContent = `${(motor.dist / 10).toFixed(0)} cm`;
  sliderFill($('tdist'));
});
$('freq').addEventListener('input', () => {
  motor.freq = +$('freq').value / 100;
  $('freqOut').textContent = `${motor.freq.toFixed(2)} Hz · peak ${Math.round(2 * Math.PI * motor.freq * 25)}°/s`;
  sliderFill($('freq'));
});
$('tdist').dispatchEvent(new Event('input'));
$('freq').dispatchEvent(new Event('input'));
document.querySelectorAll('.palsy button').forEach((b) =>
  b.addEventListener('click', () => {
    const s = +b.dataset.side;
    const on = !b.classList.contains('on');
    b.classList.toggle('on', on);
    oc[s].setPalsy(b.dataset.n, on);
    if (b.dataset.n === 'III') eyes[s].set({ pupil: on ? 7 : s === RIGHT ? optics.pupil : 3.4 }); // parasympathetic fibres ride on III
  }),
);
{
  const rows = MUSCLE_DEFS.map((d) => `<tr title="${d.name}: ${d.action}"><td class="nm"><b>${d.id}</b>${d.name.replace(' rectus', ' rect.').replace('Superior', 'Sup.').replace('Inferior', 'Inf.').toLowerCase()}</td><td class="nv">${d.nerve}</td><td><div class="bar r" id="bR${d.id}"><i></i></div></td><td><div class="bar l" id="bL${d.id}"><i></i></div></td></tr>`).join('');
  $('mtab').innerHTML = `<tr><th>Muscle</th><th>CN</th><th>Right</th><th>Left</th></tr>${rows}`;
}
const traces = new Traces(300);

// pointer → gaze target on a sphere of radius D around the bridge of the nose
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
canvas.addEventListener('pointermove', (e) => {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  motor.pointer = ndc.clone();
});
// Screen-space gaze: the pointer's offset from the bridge of the nose on screen sets the gaze
// angle, and the camera's own right/up vectors set its direction. Works at any zoom or orbit.
const GAZE_PX_PER_45 = () => 0.36 * Math.min(window.innerWidth, window.innerHeight);
function pointerTarget(D) {
  if (!motor.pointer) return dirFrom(0, 0).multiplyScalar(D);
  const w = window.innerWidth, h = window.innerHeight;
  const face = new THREE.Vector3(0, 0, G.apex).project(camera);
  const dx = ((motor.pointer.x - face.x) * w) / 2;
  const dy = ((motor.pointer.y - face.y) * h) / 2;
  const R = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const U = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const lat = new THREE.Vector3(dx * R.x + dy * U.x, dx * R.y + dy * U.y, 0);
  const px = Math.hypot(dx, dy);
  if (px < 1 || lat.lengthSq() < 1e-9) return dirFrom(0, 0).multiplyScalar(D);
  lat.normalize();
  const th = Math.min((px / GAZE_PX_PER_45()) * 45, 60) * DEG;
  const dir = new THREE.Vector3(lat.x * Math.sin(th), lat.y * Math.sin(th), Math.cos(th));
  const az = THREE.MathUtils.clamp(azOf(dir), -45, 45), el = THREE.MathUtils.clamp(elOf(dir), -38, 38);
  return dirFrom(az, el).multiplyScalar(D);
}

const H_SEQ = [[0, 0], [28, 0], [28, 20], [28, -20], [28, 0], [0, 0], [-28, 0], [-28, 20], [-28, -20], [-28, 0]];
function motorTarget(t) {
  const tt = t - (motor.t0 || 0);
  switch (motor.exp) {
    case 'h': {
      const [az, el] = H_SEQ[Math.floor(tt / 1.3) % H_SEQ.length];
      return dirFrom(az, el).multiplyScalar(motor.dist);
    }
    case 'saccade': {
      if (t - motor.lastJump > 1.1) {
        motor.lastJump = t;
        motor.jumpTarget = [(Math.random() * 2 - 1) * 32, (Math.random() * 2 - 1) * 20];
      }
      return dirFrom(...motor.jumpTarget).multiplyScalar(motor.dist);
    }
    case 'pursuit':
      return dirFrom(25 * Math.sin(2 * Math.PI * motor.freq * tt), 6 * Math.sin(Math.PI * motor.freq * tt)).multiplyScalar(motor.dist);
    case 'verge': {
      const D = 245 + 175 * Math.cos((2 * Math.PI * tt) / 7);
      return dirFrom(0, -8).multiplyScalar(D);
    }
    default:
      return pointerTarget(motor.dist);
  }
}
function desiredDir(s, T) {
  const d = T.clone().sub(eyeCenter(s)).normalize();
  const az = THREE.MathUtils.clamp(azOf(d), -48, 48), el = THREE.MathUtils.clamp(elOf(d), -42, 42);
  return dirFrom(az, el);
}
gaze.onSaccade = (amp) => {
  motor.sacc = { amp, peak: 0, t0: clock };
};

const qDes = { [RIGHT]: new THREE.Quaternion(), [LEFT]: new THREE.Quaternion() };
const qPrev = { [RIGHT]: new THREE.Quaternion(), [LEFT]: new THREE.Quaternion() };
const omegaDes = new THREE.Vector3();
let target = new THREE.Vector3(0, 0, 400);
function updateOculomotor(dt) {
  target = mode === 'motor' ? motorTarget(clock) : new THREE.Vector3(0, 0, 1e5);
  gaze.latency = motor.exp === 'follow' ? 0.12 : 0.18;
  gaze.update(dt, desiredDir(RIGHT, target), desiredDir(LEFT, target), clock);
  for (const s of SIDES) {
    qPrev[s].copy(qDes[s]);
    listingQuat(gaze.cmd[key(s)], qDes[s]);
    // desired angular velocity from successive commanded orientations
    const dq = qDes[s].clone().multiply(qPrev[s].clone().invert());
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const ang = 2 * Math.acos(Math.min(1, dq.w));
    const sn = Math.sqrt(Math.max(1 - dq.w * dq.w, 1e-12));
    omegaDes.set(dq.x / sn, dq.y / sn, dq.z / sn).multiplyScalar(dt > 0 && ang > 1e-7 ? ang / dt : 0);
    oc[s].command(qDes[s], omegaDes);
    const sub = 6;
    for (let i = 0; i < sub; i++) oc[s].step(dt / sub);
    eyes[s].group.quaternion.copy(oc[s].q);
  }
  skinUniforms.uRotR.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(oc[RIGHT].q));
  skinUniforms.uRotL.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(oc[LEFT].q));
  if (motor.sacc) {
    const v = Math.max(oc[RIGHT].omega.length(), oc[LEFT].omega.length()) / DEG;
    motor.sacc.peak = Math.max(motor.sacc.peak, v);
    if (!gaze.sacc && clock - motor.sacc.t0 > 0.06) {
      if (motor.sacc.amp > 3) {
        motor.seq.push({ a: motor.sacc.amp, v: motor.sacc.peak });
        if (motor.seq.length > 60) motor.seq.shift();
      }
      motor.sacc = null;
    }
  }
}

let uiTick = 0;
let sepSm = 0, tiltSm = 0;
function updateMotorView() {
  updateRibbons();
  targetOrb.position.copy(target);
  for (const s of SIDES) {
    const o = oc[s];
    const g = o.gaze();
    const start = g.clone().multiplyScalar(G.apex).add(o.center);
    const len = Math.max(20, target.distanceTo(o.center) - G.apex);
    const end = start.clone().addScaledVector(g, len);
    const p = lasers[s].geometry.attributes.position;
    p.setXYZ(0, start.x, start.y, start.z);
    p.setXYZ(1, end.x, end.y, end.z);
    p.needsUpdate = true;
  }
  for (const nv of nerves) {
    const o = oc[nv.side];
    const ms = o.muscles.filter((m) => nv.muscles.includes(m.id));
    const rate = (ms.reduce((a, m) => a + m.f, 0) / ms.length) * 400;
    nv.mat.uniforms.uRate.value = o.palsy[nv.nerve] ? 0 : rate;
    nv.mat.uniforms.uDead.value = o.palsy[nv.nerve] ? 1 : 0;
    nv.mat.uniforms.uTime.value = clock;
  }
  // traces
  const sample = { t: { az: azOf(target.clone().normalize()), el: elOf(target.clone().normalize()) } };
  for (const s of SIDES) {
    const g = oc[s].gaze();
    sample[key(s)] = { az: azOf(g), el: elOf(g) };
  }
  traces.push(sample);
  if (uiTick++ % 2) return;
  // double vision: each eye's image sits where the brain believes that eye points
  const images = [];
  let fix = RIGHT;
  if (Object.values(oc[RIGHT].palsy).some(Boolean) && !Object.values(oc[LEFT].palsy).some(Boolean)) fix = LEFT;
  for (const s of SIDES) {
    const o = oc[s];
    const trueDir = target.clone().sub(o.center).normalize();
    const local = trueDir.clone().applyQuaternion(o.q.clone().invert());
    const perceived = local.applyQuaternion(qDes[s]);
    const tilt = (o.torsion(o.q) - o.torsion(qDes[s])) * (s === RIGHT ? 1 : -1);
    images.push({ dx: azOf(perceived) - azOf(trueDir), dy: elOf(perceived) - elOf(trueDir), tilt, color: s === RIGHT ? '#ff4d4d' : '#e8f4ff', side: s });
  }
  const ref = images.find((im) => im.side === fix);
  for (const im of images) { im.dx -= ref.dx; im.dy -= ref.dy; }
  const raw = drawDiplopia($('dip'), images, fix);
  // low-pass the read-out: during a saccade the eyes are briefly out of step (and vision is suppressed)
  sepSm += (raw.sep - sepSm) * 0.12;
  tiltSm += (raw.tilt - tiltSm) * 0.12;
  const sep = sepSm, tilt = tiltSm;
  $('dipOut').textContent = sep < 0.8 && tilt < 1.5 ? 'single, fused' : `${fmt(sep, 1)}° apart${tilt >= 1.5 ? ` · ${fmt(tilt, 0)}° tilt` : ''}`;
  if (motor.exp === 'saccade') drawMainSequence($('trace'), motor.seq);
  else traces.draw($('trace'));
  // chips + bars
  const gr = oc[RIGHT].gaze(), gl = oc[LEFT].gaze();
  const gtxt = (g, o) => `${sgn(azOf(g), 0)}°, ${sgn(elOf(g), 0)}°<small>${sgn(o.torsion(), 0)}° tor</small>`;
  if ($('cR')) {
    $('cR').innerHTML = gtxt(gr, oc[RIGHT]);
    $('cL').innerHTML = gtxt(gl, oc[LEFT]);
    $('cV').innerHTML = `${fmt(gr.angleTo(gl) / DEG, 1)}°`;
    $('cD').innerHTML = `${fmt(sep, 1)}°`;
    $('cD').parentElement.classList.toggle('warn', sep >= 0.8 || tilt >= 1.5);
  }
  for (const s of SIDES) {
    for (const m of oc[s].muscles) {
      const el = $(`b${key(s)}${m.id}`);
      el.classList.toggle('dead', !m.alive);
      el.firstChild.style.width = `${(m.alive ? m.f : 0) * 100}%`;
      el.title = m.alive ? `≈ ${Math.round(m.f * 400)} spikes/s` : 'paralysed';
    }
  }
}

// ============================================================ wiring UI
const PRESETS = lesionPresets();
let currentLesion = PRESETS[0];
const stim = { mode: 'probe', fx: -14, fy: 10, r: 3.5, lastUser: -100 };
const lesBox = $('lesions');
lesBox.innerHTML = PRESETS.map((p) => `<button data-id="${p.id}">${p.label}</button>`).join('');
function applyLesion(p) {
  currentLesion = p;
  path.setLesions(p.list);
  lesBox.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === p.id));
  $('lesionNote').innerHTML = p.note;
  const cut = path.fibers.filter((f) => f.cut < f.total).length;
  if ($('cCut')) $('cCut').textContent = cut;
  fieldCache = null;
}
lesBox.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) applyLesion(PRESETS.find((p) => p.id === b.dataset.id));
});
document.querySelectorAll('#stimSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    stim.mode = b.dataset.s;
    document.querySelectorAll('#stimSeg button').forEach((x) => x.classList.toggle('on', x === b));
  }),
);
document.querySelectorAll('#colSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    path.setColorMode(+b.dataset.c);
    document.querySelectorAll('#colSeg button').forEach((x) => x.classList.toggle('on', x === b));
  }),
);
$('lesR').addEventListener('input', () => {
  $('lesROut').textContent = `${(+$('lesR').value / 10).toFixed(1)} mm`;
  sliderFill($('lesR'));
});
$('lesR').dispatchEvent(new Event('input'));
let placing = false;
$('placeBtn').addEventListener('click', () => {
  placing = !placing;
  $('placeBtn').classList.toggle('on', placing);
  $('placeBtn').textContent = placing ? 'Click the pathway to cut it…' : 'Place your own lesion';
});
let downAt = null;
canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
canvas.addEventListener('pointerup', (e) => {
  if (!placing || mode !== 'wiring' || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), camera);
  const targets = [...path.sheaths.children, ...Object.values(path.v1Mesh), ...SIDES.map((s) => eyes[s].meshes.retina)];
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return;
  const r = +$('lesR').value / 10;
  const base = currentLesion.id === 'custom' ? currentLesion.list : [];
  const list = [...base, { type: 'sphere', pos: hit.point.clone(), r }];
  applyLesion({ id: 'custom', label: 'Custom', list, note: '' });
  $('lesionNote').innerHTML = describeCustom();
});
function describeCustom() {
  const by = (pred) => {
    const fs = path.fibers.filter(pred);
    return fs.length ? fs.filter((f) => f.cut < f.total).length / fs.length : 0;
  };
  const pct = (x) => `${Math.round(x * 100)}%`;
  const parts = [];
  for (const [s, name] of [[RIGHT, 'Right'], [LEFT, 'Left']]) {
    const lf = by((f) => f.side === s && f.fx < 0), rf = by((f) => f.side === s && f.fx > 0);
    const up = by((f) => f.side === s && f.fy > 0), lo = by((f) => f.side === s && f.fy < 0);
    if (lf + rf < 0.01) { parts.push(`<b>${name} eye</b>: intact`); continue; }
    parts.push(`<b>${name} eye</b>: loses ${pct(lf)} of its left field, ${pct(rf)} of its right (upper ${pct(up)}, lower ${pct(lo)})`);
  }
  const n = path.fibers.filter((f) => f.cut < f.total).length;
  return `Your lesion cuts <b>${n}</b> modelled axons. ${parts.join('. ')}. Axons carry anterograde signal only, so everything downstream of a cut goes dark.`;
}

// drag on field charts to move the probe
let fieldCache = null;
let fieldGeom = {};
for (const [id, s] of [['fieldL', LEFT], ['fieldR', RIGHT]]) {
  const c = $(id);
  const move = (e) => {
    const g = fieldGeom[s];
    if (!g) return;
    const r = c.getBoundingClientRect();
    const fx = (e.clientX - r.left - g.cx) / g.k, fy = -(e.clientY - r.top - g.cy) / g.k;
    const m = Math.hypot(fx, fy);
    const k = m > 58 ? 58 / m : 1;
    stim.fx = fx * k;
    stim.fy = fy * k;
    stim.lastUser = clock;
    if (stim.mode !== 'probe') document.querySelector('#stimSeg [data-s="probe"]').click();
  };
  c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); move(e); c.onpointermove = move; });
  c.addEventListener('pointerup', () => (c.onpointermove = null));
}
function updateWiring(dt) {
  if (stim.mode === 'probe' && clock - stim.lastUser > 8) {
    const t = clock * 0.18;
    stim.fx = 32 * Math.sin(t * 1.3);
    stim.fy = 20 * Math.sin(t * 2.1 + 1);
  }
  const { seen } = path.update(dt, clock, stim);
  if (!fieldCache) fieldCache = { [LEFT]: path.fieldGrid(LEFT), [RIGHT]: path.fieldGrid(RIGHT) };
  if (uiTick++ % 2) return;
  fieldGeom[LEFT] = drawField($('fieldL'), path.grid, fieldCache[LEFT], stim, seen[LEFT], '#ff5fae');
  fieldGeom[RIGHT] = drawField($('fieldR'), path.grid, fieldCache[RIGHT], stim, seen[RIGHT], '#46d6ff');
}

// ============================================================ loop
let clock = 0;
let last = performance.now();
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}
function tick(dt) {
  clock += dt;
  if (tween) {
    tween.t = Math.min(tween.t + dt / 1.6, 1);
    const k = ease(tween.t);
    camera.position.lerpVectors(tween.from.pos, tween.to.pos, k);
    controls.target.lerpVectors(tween.from.target, tween.to.target, k);
    if (tween.t >= 1) tween = null;
  }
  controls.update();
  updateOculomotor(dt);
  if (mode === 'motor') updateMotorView();
  if (mode === 'wiring') updateWiring(dt);
  placeLabels();
  composer.render(dt);
}
// debugging hook: step the simulation without requestAnimationFrame (e.g. in background tabs)
window.__seeing = { camera, controls, setMode, tick, oc, path, optics, motor, stim, applyLesion, PRESETS: () => PRESETS };

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  for (const m of rayMats) m.resolution.set(w, h);
  if (mode === 'optics') {
    drawRetinalImage($('retImg'), optics.res.blurArcmin, THREE.MathUtils.clamp((optics.age - 35) / 40, 0, 1));
  }
});

const initial = new URLSearchParams(location.search).get('mode');
updateOptics();
setMode(MODES[initial] ? initial : 'optics', true);
requestAnimationFrame(frame);
requestAnimationFrame(() => $('fade').classList.add('gone'));
document.fonts?.ready.then(() => mode === 'optics' && drawRetinalImage($('retImg'), optics.res.blurArcmin, 0));
