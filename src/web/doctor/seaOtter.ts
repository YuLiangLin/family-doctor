// Dr.水獺 海獺醫生（原創角色）：淺色毛茸茸的大頭、深咖啡色身體、寬寬亮亮的黑鼻子、白鬍鬚，浮在水上。
// 沒有外部模型檔：頭、身體、白袍用 SDF（幾個橢球平滑相接）長成網格，頂點上色做出頭淺身深的漸層、凹處陰影；
// 毛茸茸的邊緣是「殼層毛」（同一個網格往外推幾層，用雜訊決定哪裡有毛）。
// 動作：setPose() 換姿勢，update() 每格往目標靠近；手臂用兩段 IK 讓爪子到指定位置。
import * as THREE from 'three';

// ---------- SDF ----------
type Vec3 = [number, number, number];
interface Part {
  c: Vec3;
  r: Vec3;
}
type Sdf = (x: number, y: number, z: number) => number;

function sdEllipsoid(x: number, y: number, z: number, c: Vec3, r: Vec3): number {
  const px = x - c[0];
  const py = y - c[1];
  const pz = z - c[2];
  const k0 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
  const k1 = Math.hypot(px / (r[0] * r[0]), py / (r[1] * r[1]), pz / (r[2] * r[2]));
  if (k1 < 1e-9) return -Math.min(r[0], r[1], r[2]);
  return (k0 * (k0 - 1)) / k1;
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function makeSdf(parts: Part[], k: number): Sdf {
  return (x, y, z) => {
    let d = 1e9;
    for (const p of parts) d = smin(d, sdEllipsoid(x, y, z, p.c, p.r), k);
    return d;
  };
}

/** 從中心往 (dx,dy,dz) 方向，由外往內找第一個表面（sphere tracing＋二分） */
function surfaceT(sdf: Sdf, dx: number, dy: number, dz: number, tMax = 1.4): number {
  let t = tMax;
  let prev = t;
  for (let i = 0; i < 80 && t > 0; i++) {
    const d = sdf(dx * t, dy * t, dz * t);
    if (d <= 0) break;
    prev = t;
    t -= Math.max(d * 0.9, 0.003);
  }
  let lo = Math.max(t, 0);
  let hi = prev;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2;
    if (sdf(dx * m, dy * m, dz * m) > 0) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}

function surfacePoint(sdf: Sdf, dir: Vec3): THREE.Vector3 {
  const d = new THREE.Vector3(...dir).normalize();
  return d.multiplyScalar(surfaceT(sdf, d.x, d.y, d.z));
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

type ColorFn = (x: number, y: number, z: number, out: THREE.Color) => void;

/** SDF 長成網格：法向量用 SDF 梯度（沒有接縫）、頂點色＋凹處陰影、furLen＝這裡的毛多長（0～1） */
function blobGeometry(sdf: Sdf, colorFn: ColorFn, seg: [number, number], ao = 9, furFn?: (x: number, y: number, z: number) => number) {
  const g = new THREE.SphereGeometry(1, seg[0], seg[1]);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const fur = new Float32Array(pos.count).fill(1);
  const c = new THREE.Color();
  const n = new THREE.Vector3();
  const e = 0.002;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i);
    const dy = pos.getY(i);
    const dz = pos.getZ(i);
    const t = surfaceT(sdf, dx, dy, dz);
    const x = dx * t;
    const y = dy * t;
    const z = dz * t;
    pos.setXYZ(i, x, y, z);
    n.set(sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
    colorFn(x, y, z, c);
    let occ = 0;
    for (let k = 1; k <= 5; k++) {
      const h = 0.012 * k;
      occ += (h - Math.max(0, sdf(x + n.x * h, y + n.y * h, z + n.z * h))) / 2 ** (k - 1);
    }
    c.multiplyScalar(Math.max(0.55, 1 - occ * ao));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    if (furFn) fur[i] = furFn(x, y, z);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('furLen', new THREE.BufferAttribute(fur, 1));
  g.computeBoundingSphere();
  return g;
}

/** 單色網格也要有 color、furLen（共用毛的材質） */
function solid(g: THREE.BufferGeometry) {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('furLen', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  return g;
}

// ---------- 毛 ----------
const NOISE = `
float fh(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float fnoise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(fh(i),fh(i+vec3(1,0,0)),f.x),mix(fh(i+vec3(0,1,0)),fh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(fh(i+vec3(0,0,1)),fh(i+vec3(1,0,1)),f.x),mix(fh(i+vec3(0,1,1)),fh(i+vec3(1,1,1)),f.x),f.y),f.z); }`;

/** 毛的底層：法向量加細雜訊、顏色加一點顆粒 */
function furMaterial(sheen: string, scale: number, strength: number, grain: number, clip: THREE.Plane[] | null) {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.92,
    sheen: 1,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(sheen),
    clippingPlanes: clip,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFurPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFurPos;${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\ndiffuseColor.rgb *= ${(1 - grain).toFixed(3)} + ${(grain * 2).toFixed(3)} * fnoise(vFurPos * ${(scale * 0.45).toFixed(1)});`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{ vec3 q = vFurPos * ${scale.toFixed(1)}; float e = 0.4;
  vec3 g = vec3(fnoise(q+vec3(e,0,0))-fnoise(q-vec3(e,0,0)), fnoise(q+vec3(0,e,0))-fnoise(q-vec3(0,e,0)), fnoise(q+vec3(0,0,e))-fnoise(q-vec3(0,0,e)));
  normal = normalize(normal + (g - dot(g, normal) * normal) * ${strength.toFixed(2)}); }`,
      );
  };
  m.customProgramCacheKey = () => `fur-${scale}-${strength}-${grain}`;
  return m;
}

/** 殼層毛：每層往外推一點，雜訊決定哪裡有毛；越外層越稀、越亮 */
function addShells(mesh: THREE.Mesh, count: number, length: number, density: number, sheen: string, clip: THREE.Plane[] | null) {
  for (let i = 1; i <= count; i++) {
    const h = i / count;
    const m = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.95,
      sheen: 1,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(sheen),
      clippingPlanes: clip,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uH = { value: h };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uH;\nattribute float furLen;\nvarying vec3 vFurPos;\nvarying float vFurLen;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\nvFurPos = position;\nvFurLen = furLen;\ntransformed += normal * uH * ${length.toFixed(4)} * furLen;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uH;
varying vec3 vFurPos;
varying float vFurLen;
float sh3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
{ vec3 cell = floor(vFurPos * ${density.toFixed(1)});
  vec3 f = fract(vFurPos * ${density.toFixed(1)}) - 0.5;
  if (sh3(cell) < uH || uH > vFurLen + 0.01 || length(f) > (1.0 - uH) * 0.75 + 0.15) discard; }`,
        )
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.78, 1.04, uH);');
    };
    m.customProgramCacheKey = () => `shell-${length}-${density}`;
    const s = new THREE.Mesh(mesh.geometry, m);
    s.renderOrder = 1;
    mesh.add(s);
  }
}

// ---------- 顏色、形狀 ----------
const C = {
  head: '#e3d7c5',
  headBack: '#b9a58e',
  face: '#f4efe6',
  body: '#432f25',
  bodyDark: '#2e2019',
  chest: '#bca386',
  paw: '#2e211a',
  nose: '#191311',
  ear: '#7d6650',
  brow: '#a48d74',
  coat: '#f3f5f8',
  blue: '#2f6fd6',
  band: '#3b4a5e',
};

const HEAD_PARTS: Part[] = [
  { c: [0, 0.04, -0.03], r: [0.39, 0.27, 0.33] }, // 頭頂（寬、扁）
  { c: [0.21, -0.1, 0.04], r: [0.19, 0.16, 0.19] }, // 腮幫子
  { c: [-0.21, -0.1, 0.04], r: [0.19, 0.16, 0.19] },
  { c: [0, -0.03, 0.19], r: [0.16, 0.12, 0.15] }, // 鼻樑
  { c: [0.072, -0.1, 0.28], r: [0.088, 0.078, 0.08] }, // 鬍鬚墊（ω）
  { c: [-0.072, -0.1, 0.28], r: [0.088, 0.078, 0.08] },
  { c: [0, -0.18, 0.19], r: [0.09, 0.06, 0.08] }, // 下巴
];
const HEAD_Y = 0.38;
const EYE_R = 0.034;
/** 水面高度（世界座標） */
const WATER_Y = -0.56;

// ---------- 姿勢 ----------
export type PoseName = 'idle' | 'listening' | 'thinking' | 'talking' | 'happy' | 'concerned';

interface Pose {
  /** 爪子目標（世界座標，左手 x<0） */
  pawL: Vec3;
  pawR: Vec3;
  /** 頭：低頭（+）／抬頭、轉頭、歪頭 */
  head: Vec3;
  eye: number;
  happy: number;
  mouth: number;
  brow: number;
  pill: number;
}

const POSES: Record<PoseName, Pose> = {
  idle: { pawL: [-0.11, -0.2, 0.4], pawR: [0.11, -0.2, 0.4], head: [0.03, 0, 0.04], eye: 1, happy: 0, mouth: 0.1, brow: 0, pill: 0 },
  // 招牌動作：雙手捧臉頰
  listening: { pawL: [-0.26, 0.3, 0.27], pawR: [0.26, 0.3, 0.27], head: [0.06, 0, -0.1], eye: 1.08, happy: 0, mouth: 0.05, brow: 0.15, pill: 0 },
  // 把「最愛的石頭」（一顆膠囊）抱在胸前、歪頭往上看
  thinking: { pawL: [-0.075, -0.1, 0.45], pawR: [0.075, -0.1, 0.45], head: [-0.16, -0.12, 0.22], eye: 1, happy: 0, mouth: 0.08, brow: 0.3, pill: 1 },
  talking: { pawL: [-0.12, -0.18, 0.42], pawR: [0.22, 0.02, 0.4], head: [0.02, 0.08, 0], eye: 1, happy: 0, mouth: 0.75, brow: 0.05, pill: 0 },
  // 拍拍手
  happy: { pawL: [-0.07, 0.08, 0.46], pawR: [0.07, 0.08, 0.46], head: [-0.08, 0, 0.06], eye: 1, happy: 1, mouth: 0.7, brow: -0.2, pill: 0 },
  // 雙手合在胸前、眉頭皺起來
  concerned: { pawL: [-0.05, 0.1, 0.44], pawR: [0.05, 0.1, 0.44], head: [0.14, 0, -0.08], eye: 1, happy: 0, mouth: 0.12, brow: 1, pill: 0 },
};

export interface SeaOtterOptions {
  /** 暗色模式（水的顏色、環境光） */
  dark?: boolean;
  /** 毛的殼層數（0＝不要，效能差的裝置用） */
  shells?: number;
}

export interface SeaOtter {
  root: THREE.Group;
  setPose(name: PoseName, face?: { worried?: boolean; urgent?: boolean }): void;
  /** t：秒；look：-1～1（頭往游標方向轉）；calm：減少動作 */
  update(t: number, dt: number, opts?: { look?: { x: number; y: number }; calm?: boolean }): void;
  dispose(): void;
}

export function buildSeaOtter({ dark = false, shells = 12 }: SeaOtterOptions = {}): SeaOtter {
  const root = new THREE.Group();
  const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y)];
  const col = (hex: string) => new THREE.Color(hex);

  // 材質
  const furBody = furMaterial('#d9c2a8', 170, 0.16, 0.07, clip);
  const furHead = furMaterial('#ffffff', 210, 0.12, 0.05, null);
  const pawMat = furMaterial('#8b7462', 200, 0.15, 0.06, clip);
  pawMat.color = col(C.paw);
  const earMat = furMaterial('#e8d6c2', 90, 0.25, 0.1, null);
  earMat.color = col(C.ear);
  const glossy = (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
  const noseMat = glossy(C.nose);
  noseMat.roughness = 0.5;
  const eyeMat = glossy('#0b0807');
  const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const mouthMat = new THREE.MeshStandardMaterial({ color: '#4a1f1e', roughness: 0.7 });
  const tongueMat = new THREE.MeshStandardMaterial({ color: '#e07f86', roughness: 0.6 });
  const lineMat = new THREE.MeshStandardMaterial({ color: '#2a1d18', roughness: 0.8 });
  const padLineMat = new THREE.MeshStandardMaterial({ color: '#8a7564', roughness: 0.9 });
  const whiskerMat = new THREE.MeshStandardMaterial({ color: '#fbf8f2', roughness: 0.4, emissive: '#5a5148', emissiveIntensity: 0.25 });
  const browMat = new THREE.MeshStandardMaterial({ color: C.brow, roughness: 0.9, transparent: true, opacity: 0, depthWrite: false });
  const stethMat = new THREE.MeshPhysicalMaterial({ color: C.blue, roughness: 0.35, clearcoat: 0.6 });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#eef2f6', roughness: 0.22, metalness: 0.55 });
  const coatMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, clippingPlanes: clip });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: '#fbfcfe', roughness: 0.8, clippingPlanes: clip });

  // ---- 身體（中心在水面上方一點，水面以下切掉） ----
  const bodySdf = makeSdf(
    [
      { c: [0, 0, 0], r: [0.42, 0.55, 0.35] },
      { c: [0, 0.4, 0.03], r: [0.32, 0.26, 0.27] },
      { c: [0, -0.05, 0.1], r: [0.34, 0.4, 0.29] },
      { c: [0, 0.66, 0.02], r: [0.27, 0.16, 0.24] }, // 脖子：頭身交界是毛色漸層
    ],
    0.12,
  );
  const cBody = col(C.body);
  const cDark = col(C.bodyDark);
  const cChest = col(C.chest);
  const cHead = col(C.head);
  const body = new THREE.Mesh(
    blobGeometry(
      bodySdf,
      (_x, y, z, out) => {
        out.copy(cBody).lerp(cDark, smooth(0.1, -0.35, z) * 0.6);
        out.lerp(cChest, smooth(0.22, 0.62, y) * (0.5 + 0.4 * smooth(-0.1, 0.25, z)));
        out.lerp(cHead, smooth(0.55, 0.75, y) * 0.9);
      },
      [96, 72],
    ),
    furBody,
  );
  body.position.set(0, -0.5, 0);
  root.add(body);
  if (shells > 0) addShells(body, Math.max(4, Math.round(shells * 0.6)), 0.016, 220, '#d9c2a8', clip);

  // ---- 小白袍：身體往外膨脹一點，前面開 V 領、後領比較高；邊緣用 shader 切（才平滑） ----
  const coatSdf: Sdf = (x, y, z) => bodySdf(x, y, z) - 0.03;
  const coatWhite = col(C.coat);
  coatMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoat = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoat;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{ float w = max(0.0, vCoat.y - 0.02) * 0.5;
  float d = abs(vCoat.x) - w;
  float front = step(0.05, vCoat.z);
  float lapel = front * step(0.12, vCoat.y) * (1.0 - smoothstep(0.045, 0.055, d));
  diffuseColor.rgb *= 1.0 - lapel * 0.07;
  diffuseColor.rgb *= 1.0 - front * (1.0 - smoothstep(0.0, 0.006, d)) * 0.25;
  float seam = front * step(vCoat.y, 0.02) * (1.0 - smoothstep(0.002, 0.005, abs(vCoat.x)));
  diffuseColor.rgb *= 1.0 - seam * 0.22; }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{ float top = 0.47 + 0.1 * smoothstep(0.1, -0.25, vCoat.z);
  float w = max(0.0, vCoat.y - 0.02) * 0.5;
  if (vCoat.y > top || (vCoat.z > 0.05 && abs(vCoat.x) < w)) discard; }`,
      );
  };
  const coat = new THREE.Mesh(
    blobGeometry(coatSdf, (_x, _y, _z, out) => out.copy(coatWhite), [96, 72], 6),
    coatMat,
  );
  coat.position.copy(body.position);
  root.add(coat);
  const btnMat = new THREE.MeshStandardMaterial({ color: '#c9d2dc', roughness: 0.4 });
  for (const by of [-0.05, -0.2]) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 16), btnMat);
    btn.position.copy(surfacePoint(coatSdf, [0, by, 1])).add(body.position).add(new THREE.Vector3(0, 0, 0.003));
    btn.rotation.x = Math.PI / 2;
    root.add(btn);
  }
  // 胸前口袋＋筆
  {
    const pk = surfacePoint(coatSdf, [-0.55, 0.05, 0.83]);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.006), new THREE.MeshStandardMaterial({ color: '#dfe6ee', roughness: 0.8 }));
    pocket.position.copy(pk).add(body.position).add(new THREE.Vector3(0, 0, 0.004));
    pocket.lookAt(pocket.position.clone().add(pk.clone().normalize()));
    root.add(pocket);
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.09, 10), new THREE.MeshStandardMaterial({ color: C.blue, roughness: 0.4 }));
    pen.position.copy(pocket.position).add(new THREE.Vector3(0.025, 0.02, -0.012));
    pen.rotation.set(-0.25, 0, -0.08);
    root.add(pen);
  }

  // ---- 頭 ----
  const headPivot = new THREE.Group();
  headPivot.position.set(0, HEAD_Y, 0.02);
  root.add(headPivot);
  const head = new THREE.Group();
  headPivot.add(head);
  const headSdf = makeSdf(HEAD_PARTS, 0.07);
  const cFace = col(C.face);
  const cBack = col(C.headBack);
  const headMesh = new THREE.Mesh(
    blobGeometry(
      headSdf,
      (_x, y, z, out) => {
        out.copy(cHead);
        out.lerp(cBack, smooth(0.05, -0.32, z) * smooth(-0.15, 0.2, y) * 0.75);
        out.lerp(cFace, smooth(0.1, 0.24, z) * smooth(0.02, -0.08, y));
        out.lerp(cChest, smooth(-0.15, -0.27, y) * smooth(0.1, -0.1, z) * 0.6);
      },
      [128, 96],
      9,
      // 臉上的毛短（不要蓋住眼睛、鼻子）
      (x, y, z) => 1 - 0.75 * smooth(0.1, 0.24, z) * smooth(0.14, 0.02, y) * smooth(0.3, 0.12, Math.abs(x)),
    ),
    furHead,
  );
  head.add(headMesh);
  if (shells > 0) addShells(headMesh, shells, 0.014, 300, '#ffffff', null);

  // 耳朵：小小的、低低的
  for (const s of [-1, 1]) {
    const p = surfacePoint(headSdf, [s * 0.93, 0.3, -0.2]);
    const ear = new THREE.Mesh(solid(new THREE.SphereGeometry(1, 24, 16)), earMat);
    ear.scale.set(0.035, 0.042, 0.024);
    ear.position.copy(p).multiplyScalar(0.99);
    ear.lookAt(p.clone().multiplyScalar(3));
    head.add(ear);
  }

  // 眼睛（小小黑黑亮亮）＋笑眼
  const eyes: THREE.Group[] = [];
  const happyEyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const p = surfacePoint(headSdf, [s * 0.118 * 2.6, 0.012 * 2.6, 0.92]);
    const g = new THREE.Group();
    g.position.copy(p).add(new THREE.Vector3(0, 0, -EYE_R * 0.45));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 32, 24), eyeMat);
    ball.scale.set(1, 1.05, 0.8);
    g.add(ball);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(EYE_R * 0.26, 16, 12), shineMat);
    shine.position.set(-EYE_R * 0.3, EYE_R * 0.38, EYE_R * 0.72);
    g.add(shine);
    head.add(g);
    eyes.push(g);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(EYE_R * 0.85, EYE_R * 0.24, 10, 24, Math.PI), lineMat);
    arc.position.copy(p).add(new THREE.Vector3(0, -EYE_R * 0.3, -EYE_R * 0.05));
    arc.visible = false;
    head.add(arc);
    happyEyes.push(arc);
  }

  // 眉毛：平常看不到，擔心時淡淡出現
  const brows: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const p = surfacePoint(headSdf, [s * 0.118 * 2.4, 0.012 * 2.6 + 0.24, 0.85]);
    const g = new THREE.Group();
    g.position.copy(p).addScaledVector(p.clone().normalize(), 0.006);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.045, 4, 8), browMat);
    m.rotation.z = Math.PI / 2;
    g.add(m);
    g.userData = { base: g.position.y, side: s };
    head.add(g);
    brows.push(g);
  }

  // 鼻子：寬寬的、亮亮的倒三角
  const noseSdf = makeSdf(
    [
      { c: [-0.03, 0.006, 0], r: [0.05, 0.034, 0.032] },
      { c: [0.03, 0.006, 0], r: [0.05, 0.034, 0.032] },
      { c: [0, -0.02, 0.005], r: [0.028, 0.026, 0.026] },
    ],
    0.03,
  );
  const nose = new THREE.Mesh(
    blobGeometry(noseSdf, (_x, _y, _z, out) => out.set(1, 1, 1), [48, 32], 0),
    noseMat,
  );
  nose.position.copy(surfacePoint(headSdf, [0, -0.04, 1])).add(new THREE.Vector3(0, 0, -0.012));
  nose.scale.setScalar(1.05);
  head.add(nose);

  // 人中、ω 嘴線、嘴巴
  const philtrum = new THREE.Mesh(new THREE.CapsuleGeometry(0.005, 0.035, 4, 6), lineMat);
  philtrum.position.copy(surfacePoint(headSdf, [0, -0.38, 0.92])).add(new THREE.Vector3(0, 0.03, 0));
  head.add(philtrum);
  for (const pad of HEAD_PARTS.filter((q) => q.c[2] > 0.25)) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(pad.r[0] * 0.55, 0.0032, 6, 24, Math.PI * 0.6), padLineMat);
    arc.position.set(pad.c[0] * 0.98, pad.c[1] + 0.005, pad.c[2] + pad.r[2] * 0.83);
    arc.rotation.set(-0.35, 0, Math.PI * 1.2);
    head.add(arc);
  }
  const mouth = new THREE.Group();
  mouth.position.copy(surfacePoint(headSdf, [0, -0.56, 0.83])).add(new THREE.Vector3(0, 0, -0.01));
  const mouthIn = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), mouthMat);
  mouthIn.scale.set(1, 0.6, 0.5);
  mouth.add(mouthIn);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12), tongueMat);
  tongue.position.set(0, -0.012, 0.008);
  tongue.scale.set(1, 0.5, 0.6);
  mouth.add(tongue);
  head.add(mouth);

  // 鬍鬚：從鬍鬚墊往兩邊
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const f = i / 5;
      const start = surfacePoint(headSdf, [s * (0.42 + f * 0.12), -0.3 - f * 0.22, 0.86]);
      const L = 0.27 * (1 - Math.abs(f - 0.35) * 0.5);
      const curve = new THREE.CatmullRomCurve3([
        start.clone().multiplyScalar(0.985),
        start.clone().add(new THREE.Vector3(s * L * 0.35, 0.012 - f * 0.02, 0.005)),
        start.clone().add(new THREE.Vector3(s * L * 0.7, -0.005 - f * 0.05, -0.02)),
        start.clone().add(new THREE.Vector3(s * L, -0.03 - f * 0.08, -0.06)),
      ]);
      head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0035, 5, false), whiskerMat));
    }
  }

  // 額鏡：細帶子＋額頭偏右的反光鏡
  {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.011, 8, 72), new THREE.MeshStandardMaterial({ color: C.band, roughness: 0.6 }));
    band.position.set(0, 0.17, 0);
    band.rotation.x = Math.PI / 2 - 0.22;
    band.scale.set(1, 0.84, 1);
    head.add(band);
    const mp = surfacePoint(headSdf, [0.32, 0.7, 0.66]);
    const m = new THREE.Group();
    m.position.copy(mp).add(new THREE.Vector3(0, 0.012, 0.022));
    m.rotation.set(-0.75, 0.3, -0.15);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.009, 10, 40), new THREE.MeshStandardMaterial({ color: '#aab6c4', roughness: 0.3, metalness: 0.6 }));
    rim.position.z = 0.006;
    m.add(rim);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.068, 0.012, 40),
      new THREE.MeshPhysicalMaterial({ color: '#eef3f8', roughness: 0.18, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
    );
    disc.rotation.x = Math.PI / 2;
    m.add(disc);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.014, 16), eyeMat);
    hole.rotation.x = Math.PI / 2;
    hole.position.z = 0.002;
    m.add(hole);
    head.add(m);
  }

  // ---- 聽診器（掛在脖子上，白袍外面） ----
  {
    const pts = (
      [
        [0.07, -0.16, 0.4],
        [-0.08, -0.06, 0.38],
        [-0.22, 0.05, 0.27],
        [-0.29, 0.13, 0.08],
        [-0.22, 0.17, -0.18],
        [0, 0.17, -0.28],
        [0.22, 0.17, -0.18],
        [0.29, 0.13, 0.08],
        [0.22, 0.05, 0.27],
        [0.12, -0.04, 0.38],
        [0.075, -0.14, 0.405],
      ] as Vec3[]
    ).map((p) => new THREE.Vector3(...p));
    root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.017, 10, false), stethMat));
    const chest = new THREE.Group();
    chest.position.set(0.075, -0.2, 0.41);
    chest.rotation.x = 0.25;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.048, 0.025, 32), metalMat);
    disc.rotation.x = Math.PI / 2;
    chest.add(disc);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12), metalMat);
    stem.position.set(0, 0.04, -0.01);
    chest.add(stem);
    root.add(chest);
  }

  // ---- 手臂：兩段，IK 讓爪子到目標；白袍袖子跟著 ----
  const L1 = 0.17;
  const L2 = 0.16;
  const R = 0.072;
  const unitY = new THREE.Vector3(0, 1, 0);
  const armGeo = (len: number, r: number) => {
    const g = new THREE.CapsuleGeometry(r, len, 8, 16);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cBody.toArray(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  interface Arm {
    s: number;
    upper: THREE.Mesh;
    lower: THREE.Mesh;
    paw: THREE.Mesh;
    sleeveU: THREE.Mesh;
    sleeveL: THREE.Mesh;
    shoulder: THREE.Vector3;
    cur: THREE.Vector3;
  }
  const arms: Arm[] = [-1, 1].map((s) => {
    const upper = new THREE.Mesh(armGeo(L1, R), furBody);
    const lower = new THREE.Mesh(armGeo(L2, R * 0.82), furBody);
    const paw = new THREE.Mesh(solid(new THREE.SphereGeometry(1, 24, 16)), pawMat);
    paw.scale.set(0.074, 0.07, 0.058);
    const sleeveU = new THREE.Mesh(new THREE.CapsuleGeometry(R * 1.28, L1, 8, 16), sleeveMat);
    const sleeveL = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.12, R * 1.22, L2 * 0.62, 20), sleeveMat);
    root.add(upper, lower, paw, sleeveU, sleeveL);
    return { s, upper, lower, paw, sleeveU, sleeveL, shoulder: new THREE.Vector3(s * 0.29, -0.06, 0.12), cur: new THREE.Vector3(s * 0.11, -0.2, 0.4) };
  });

  // 最愛的石頭＝一顆藍白膠囊
  const pill = new THREE.Group();
  {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.1, 8, 16), new THREE.MeshPhysicalMaterial({ color: '#f7f7f4', roughness: 0.3, clearcoat: 1 }));
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.0378, 0.05, 8, 16), new THREE.MeshPhysicalMaterial({ color: C.blue, roughness: 0.3, clearcoat: 1 }));
    b.position.y = 0.042;
    pill.add(a, b);
    pill.rotation.set(0.3, 0, Math.PI / 2 - 0.15);
    pill.visible = false;
    root.add(pill);
  }

  // ---- 水面＋漣漪 ----
  const water = new THREE.Group();
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const grd = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    const stops: [number, string][] = dark
      ? [
          [0, 'rgba(30,78,118,0.98)'],
          [0.22, 'rgba(36,92,136,0.95)'],
          [0.4, 'rgba(44,104,150,0.8)'],
          [0.75, 'rgba(44,104,150,0.25)'],
          [1, 'rgba(44,104,150,0)'],
        ]
      : [
          [0, 'rgba(62,128,170,0.98)'],
          [0.22, 'rgba(96,165,206,0.95)'],
          [0.4, 'rgba(126,190,224,0.88)'],
          [0.75, 'rgba(170,215,238,0.35)'],
          [1, 'rgba(190,225,242,0)'],
        ];
    for (const [o, c] of stops) grd.addColorStop(o, c);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
  }
  const waterTex = new THREE.CanvasTexture(cv);
  waterTex.colorSpace = THREE.SRGBColorSpace;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 64), new THREE.MeshBasicMaterial({ map: waterTex, transparent: true, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  water.add(disc);
  const ripples = [0, 1, 2].map((i) => {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.44, 0.008, 6, 80),
      new THREE.MeshBasicMaterial({ color: dark ? '#9cc7ea' : '#ffffff', transparent: true, opacity: 0.7, depthWrite: false }),
    );
    r.rotation.x = Math.PI / 2;
    r.position.z = 0.03;
    r.userData.phase = i / 3;
    water.add(r);
    return r;
  });
  water.position.y = WATER_Y;
  root.add(water);

  // ---------- 動作 ----------
  let pose: Pose = { ...POSES.idle };
  let poseName: PoseName = 'idle';
  let lean = 0;
  const cur = { head: new THREE.Vector3(...POSES.idle.head), eye: 1, happy: 0, mouth: 0.1, brow: 0, pill: 0, lean: 0 };
  const blink = { next: 1.5, t: -1 };
  // 待機時偶爾用爪子搓搓臉（海獺洗臉）
  const groom = { next: 9, t: -1 };
  const tmp = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const S0 = new THREE.Vector3();
  const E = new THREE.Vector3();
  const T = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function seg(mesh: THREE.Object3D, p: THREE.Vector3, q: THREE.Vector3) {
    mesh.position.copy(p).add(q).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(unitY, tmp.copy(q).sub(p).normalize());
  }

  function placeArm(a: Arm, target: THREE.Vector3) {
    S0.copy(a.shoulder);
    dir.copy(target).sub(S0);
    const d = Math.min(dir.length(), L1 + L2 - 0.005);
    dir.normalize();
    T.copy(S0).addScaledVector(dir, d);
    const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    pole.set(a.s * 0.55, -1, -0.15);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    E.copy(S0).addScaledVector(dir, along).addScaledVector(pole, h);
    seg(a.upper, S0, E);
    seg(a.lower, E, T);
    seg(a.sleeveU, S0, E);
    a.sleeveL.position.copy(E).lerp(T, 0.36);
    a.sleeveL.quaternion.setFromUnitVectors(unitY, tmp.copy(E).sub(T).normalize());
    a.paw.position.copy(T);
    a.paw.quaternion.setFromUnitVectors(unitY, tmp.copy(T).sub(E).normalize());
  }

  function setPose(name: PoseName, face: { worried?: boolean; urgent?: boolean } = {}) {
    poseName = name;
    pose = { ...POSES[name] };
    if (face.worried) pose.brow = Math.max(pose.brow, face.urgent ? 1 : 0.8);
    lean = face.urgent ? 0.1 : 0;
  }

  function update(t: number, dt: number, { look = { x: 0, y: 0 }, calm = false } = {}) {
    const k = Math.min(1, dt * 7);
    const amp = calm ? 0.25 : 1;
    cur.head.lerp(tmp.set(...pose.head), k);
    cur.eye += (pose.eye - cur.eye) * k;
    cur.happy += (pose.happy - cur.happy) * k;
    cur.mouth += (pose.mouth - cur.mouth) * k;
    cur.brow += (pose.brow - cur.brow) * k;
    cur.pill += (pose.pill - cur.pill) * k;
    cur.lean += (lean - cur.lean) * k;

    // 跟著水波上下漂；水面不動
    const bob = Math.sin(t * 1.4) * 0.018 * amp;
    root.position.y = bob;
    root.rotation.x = cur.lean;
    water.position.y = WATER_Y - bob;
    for (const r of ripples) {
      const ph = (t * 0.25 + r.userData.phase) % 1;
      r.scale.setScalar(1 + ph * 1.6);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - ph) * (calm ? 0.5 : 1);
    }

    // 頭：姿勢＋看游標＋一點點晃
    headPivot.rotation.set(
      cur.head.x - look.y * 0.12 * amp + Math.sin(t * 1.4 + 0.6) * 0.02 * amp,
      cur.head.y + look.x * 0.3 * amp + Math.sin(t * 0.5) * 0.04 * amp,
      cur.head.z + Math.sin(t * 0.7) * 0.025 * amp,
    );

    // 眨眼（每 2～5 秒）
    if (t > blink.next && blink.t < 0) blink.t = 0;
    let open = cur.eye;
    if (blink.t >= 0) {
      blink.t += dt;
      const p = blink.t / 0.16;
      open *= Math.abs(1 - Math.min(2, p * 2)) * 0.95 + 0.05;
      if (p >= 1) {
        blink.t = -1;
        blink.next = t + 2 + Math.random() * 3;
      }
    }
    const smiling = cur.happy > 0.5;
    for (const e of eyes) {
      e.visible = !smiling;
      e.scale.set(cur.eye, open, 1);
    }
    for (const a of happyEyes) a.visible = smiling;

    // 嘴：說話時開合
    let m = cur.mouth;
    if (poseName === 'talking') m *= 0.35 + Math.abs(Math.sin(t * 12) * Math.sin(t * 4.7)) * 0.9;
    mouth.scale.set(1, Math.max(0.12, m), 1);
    mouth.visible = m > 0.16;
    tongue.visible = m > 0.3;

    // 眉
    browMat.opacity = Math.min(1, Math.max(0, cur.brow)) * 0.85;
    for (const g of brows) {
      g.rotation.z = -g.userData.side * cur.brow * 0.45;
      g.position.y = g.userData.base + cur.brow * 0.012;
    }

    // 洗臉：待機時每 8～14 秒搓一下臉頰
    if (poseName === 'idle' && !calm && t > groom.next && groom.t < 0) groom.t = 0;
    let rub = 0;
    if (groom.t >= 0) {
      groom.t += dt;
      rub = Math.sin(Math.min(1, groom.t / 2.2) * Math.PI);
      if (groom.t > 2.2 || poseName !== 'idle') {
        groom.t = -1;
        groom.next = t + 8 + Math.random() * 6;
        rub = 0;
      }
    }

    // 手
    const [l, r] = arms;
    const clap = (i: number) => (poseName === 'happy' ? Math.max(0, Math.sin(t * 9)) * 0.05 * (i ? 1 : -1) * amp : 0);
    const gest = poseName === 'talking' ? Math.sin(t * 3) * 0.05 * amp : 0;
    const scrub = Math.sin(t * 10) * 0.025 * rub;
    const target = (p: Vec3, i: number) => {
      const s = i ? 1 : -1;
      const g: Vec3 = [s * 0.25, 0.27 + scrub * s, 0.28];
      return tmp.set(p[0] + (g[0] - p[0]) * rub + clap(i), p[1] + (g[1] - p[1]) * rub + (i ? gest : 0), p[2] + (g[2] - p[2]) * rub);
    };
    l.cur.lerp(target(pose.pawL, 0), k);
    placeArm(l, l.cur);
    r.cur.lerp(target(pose.pawR, 1), k);
    placeArm(r, r.cur);

    pill.visible = cur.pill > 0.5;
    if (pill.visible) pill.position.copy(l.paw.position).add(r.paw.position).multiplyScalar(0.5).add(tmp.set(0, 0.035, 0.035));
  }

  function dispose() {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat.dispose();
      }
    });
    waterTex.dispose();
  }

  setPose('idle');
  update(0, 1);
  return { root, setPose, update, dispose };
}

/** 燈光：主光、補光、背後的輪廓光（讓毛的邊緣亮起來） */
export function addLights(scene: THREE.Scene, dark: boolean): THREE.Object3D[] {
  const hemi = new THREE.HemisphereLight('#ffffff', dark ? '#3a4658' : '#cfd9e6', dark ? 1.3 : 1.7);
  const key = new THREE.DirectionalLight('#fff4e6', 2.2);
  key.position.set(1.6, 2.6, 3.5);
  const fill = new THREE.DirectionalLight('#c9dcf5', 0.7);
  fill.position.set(-3, 0.5, 2);
  const rim = new THREE.DirectionalLight('#ffffff', 2.4);
  rim.position.set(-0.6, 2.2, -3);
  const lights = [hemi, key, fill, rim];
  scene.add(...lights);
  return lights;
}
