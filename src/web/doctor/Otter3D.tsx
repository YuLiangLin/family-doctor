// Dr.Claude：小爪水獺醫生（原創角色，全部用基本幾何形狀組成，沒有外部模型檔）。
// 狀態：idle 待機（呼吸、眨眼、看手指）、listening 聽（耳朵豎起、往前傾）、thinking 想（歪頭、爪子托下巴、眼睛往上看）、
// talking 說話（嘴巴開合）。表情 mood：calm／happy（瞇眼、揮手）／concerned（皺眉）／urgent（皺眉更深、身體往前）。
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Mood } from '../../shared/apiTypes';

export type OtterState = 'idle' | 'listening' | 'thinking' | 'talking';

const FUR = '#8a5a3b';
const FUR_DARK = '#6a4128';
const CREAM = '#f3e3cc';
const COAT = '#fbfdff';
const NOSE = '#2a1a12';
const STETH = '#2c4f8c';
const METAL = '#c9d3df';

interface Props {
  state: OtterState;
  mood: Mood | '';
  /** 0～1：TTS 講話時的音量感（沒有就用時間假裝） */
  reduceMotion?: boolean;
}

function useMats() {
  return useMemo(
    () => ({
      fur: new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.85 }),
      furDark: new THREE.MeshStandardMaterial({ color: FUR_DARK, roughness: 0.9 }),
      cream: new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.9 }),
      coat: new THREE.MeshStandardMaterial({ color: COAT, roughness: 0.7, side: THREE.DoubleSide }),
      nose: new THREE.MeshStandardMaterial({ color: NOSE, roughness: 0.35 }),
      eye: new THREE.MeshStandardMaterial({ color: '#120c08', roughness: 0.2 }),
      shine: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      mouth: new THREE.MeshStandardMaterial({ color: '#5a2320', roughness: 0.6 }),
      steth: new THREE.MeshStandardMaterial({ color: STETH, roughness: 0.5 }),
      metal: new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.25, metalness: 0.7 }),
      cheek: new THREE.MeshStandardMaterial({ color: '#f2a08a', roughness: 1, transparent: true, opacity: 0.55 }),
      whisker: new THREE.MeshBasicMaterial({ color: '#3a2a20' }),
      shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.12 }),
    }),
    [],
  );
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function Otter({ state, mood, reduceMotion }: Props) {
  const m = useMats();
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group[]>([]);
  const pupils = useRef<THREE.Group[]>([]);
  const mouth = useRef<THREE.Mesh>(null);
  const brows = useRef<THREE.Group[]>([]);
  const ears = useRef<THREE.Mesh[]>([]);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Mesh>(null);
  const blink = useRef({ next: 2, t: -1 });

  useFrame(({ clock, pointer }, delta) => {
    const t = clock.elapsedTime;
    const k = Math.min(1, delta * 6); // 平滑係數
    const amp = reduceMotion ? 0.25 : 1;
    const happy = mood === 'happy';
    const worried = mood === 'concerned' || mood === 'urgent';

    // 呼吸、整體上下
    if (body.current) {
      body.current.position.y = Math.sin(t * 1.6) * 0.025 * amp + (happy ? Math.abs(Math.sin(t * 4)) * 0.03 * amp : 0);
      const lean = state === 'listening' ? 0.12 : mood === 'urgent' ? 0.1 : 0;
      body.current.rotation.x = lerp(body.current.rotation.x, lean, k);
    }
    // 頭：看手指（待機）、歪頭（想）、說話時點頭
    if (head.current) {
      const thinking = state === 'thinking';
      const targetY = thinking ? -0.25 : pointer.x * 0.35 * amp;
      const targetX = thinking ? -0.12 : -pointer.y * 0.2 * amp + (state === 'talking' ? Math.sin(t * 6) * 0.03 * amp : 0);
      const targetZ = thinking ? 0.22 : worried ? -0.06 : Math.sin(t * 0.7) * 0.04 * amp;
      head.current.rotation.y = lerp(head.current.rotation.y, targetY, k);
      head.current.rotation.x = lerp(head.current.rotation.x, targetX, k);
      head.current.rotation.z = lerp(head.current.rotation.z, targetZ, k);
    }
    // 眨眼（每 2～5 秒）；開心時瞇眼
    const b = blink.current;
    if (t > b.next && b.t < 0) b.t = 0;
    let open = happy ? 0.45 : 1;
    if (b.t >= 0) {
      b.t += delta;
      const p = b.t / 0.16;
      open = Math.min(open, Math.abs(1 - Math.min(2, p * 2)) * open + 0.05);
      if (p >= 1) {
        b.t = -1;
        b.next = t + 2 + Math.random() * 3;
      }
    }
    for (const e of eyes.current) if (e) e.scale.y = lerp(e.scale.y, open, 0.6);
    // 眼珠：想事情時往上看
    for (const p of pupils.current) {
      if (!p) continue;
      p.position.y = lerp(p.position.y, state === 'thinking' ? 0.025 : 0, k);
      p.position.x = lerp(p.position.x, state === 'thinking' ? 0.02 : pointer.x * 0.015, k);
    }
    // 嘴：說話時開合
    if (mouth.current) {
      const talk = state === 'talking' ? 0.35 + Math.abs(Math.sin(t * 13) * Math.sin(t * 5.3)) * 0.9 : happy ? 0.45 : 0.18;
      mouth.current.scale.y = lerp(mouth.current.scale.y, talk, 0.5);
    }
    // 眉毛：擔心時內側往上
    brows.current.forEach((br, i) => {
      if (!br) return;
      const dir = i === 0 ? 1 : -1;
      const angle = mood === 'urgent' ? 0.5 : worried ? 0.32 : happy ? -0.12 : 0;
      br.rotation.z = lerp(br.rotation.z, dir * angle, k);
      br.position.y = lerp(br.position.y, 0.24 + (worried ? 0.015 : 0), k);
    });
    // 耳朵：聽的時候豎起來、偶爾抖一下
    ears.current.forEach((ear, i) => {
      if (!ear) return;
      const perk = state === 'listening' ? 1.25 : 1;
      const twitch = Math.sin(t * 9 + i) > 0.985 ? 0.15 : 0;
      ear.scale.y = lerp(ear.scale.y, perk + twitch, k);
    });
    // 右手：開心揮手、想事情托下巴、說話時比手勢
    if (armR.current) {
      const target = happy
        ? { z: 2.3 + Math.sin(t * 8) * 0.35 * amp, x: 0 }
        : state === 'thinking'
          ? { z: 1.2, x: -1.0 }
          : state === 'talking'
            ? { z: 0.5 + Math.sin(t * 3) * 0.2 * amp, x: -0.5 }
            : { z: 0.25 + Math.sin(t * 1.6) * 0.03, x: 0 };
      armR.current.rotation.z = lerp(armR.current.rotation.z, target.z, k);
      armR.current.rotation.x = lerp(armR.current.rotation.x, target.x, k);
    }
    if (armL.current) {
      const z = mood === 'urgent' ? -0.9 : -0.25 - Math.sin(t * 1.6) * 0.03;
      armL.current.rotation.z = lerp(armL.current.rotation.z, z, k);
    }
    if (tail.current) tail.current.rotation.y = Math.sin(t * 1.3) * 0.35 * amp;
    if (root.current) root.current.rotation.y = lerp(root.current.rotation.y, pointer.x * 0.15 * amp, k * 0.5);
  });

  const whiskers = [-1, 1].flatMap((side) =>
    [0, 1, 2].map((i) => (
      <mesh key={`${side}-${i}`} material={m.whisker} position={[side * 0.2, -0.08 - i * 0.025, 0.42]} rotation={[0, 0, side * (0.12 - i * 0.12)]}>
        <boxGeometry args={[0.2, 0.006, 0.006]} />
      </mesh>
    )),
  );

  return (
    <group ref={root} position={[0, -0.42, 0]}>
      <mesh material={m.shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.62, 0]}>
        <circleGeometry args={[0.75, 40]} />
      </mesh>
      <group ref={body}>
        {/* 尾巴 */}
        <mesh ref={tail} material={m.furDark} position={[0, -0.45, -0.35]} rotation={[1.2, 0, 0]}>
          <capsuleGeometry args={[0.13, 0.5, 8, 16]} />
        </mesh>
        {/* 身體＋肚子 */}
        <mesh material={m.fur} position={[0, -0.12, 0]} scale={[1, 1, 0.85]}>
          <capsuleGeometry args={[0.42, 0.45, 12, 24]} />
        </mesh>
        <mesh material={m.cream} position={[0, -0.12, 0.17]} scale={[0.75, 0.95, 0.6]}>
          <sphereGeometry args={[0.42, 24, 24]} />
        </mesh>
        {/* 白袍：前面開口 */}
        <mesh material={m.coat} position={[0, -0.25, 0]} scale={[1, 1, 0.88]}>
          <cylinderGeometry args={[0.47, 0.55, 0.7, 32, 1, true, Math.PI * 0.62, Math.PI * 1.76]} />
        </mesh>
        <mesh material={m.coat} position={[-0.17, 0.02, 0.32]} rotation={[0.25, 0.45, 0.5]}>
          <boxGeometry args={[0.12, 0.3, 0.02]} />
        </mesh>
        <mesh material={m.coat} position={[0.17, 0.02, 0.32]} rotation={[0.25, -0.45, -0.5]}>
          <boxGeometry args={[0.12, 0.3, 0.02]} />
        </mesh>
        {/* 口袋上的筆 */}
        <mesh material={m.steth} position={[0.3, -0.16, 0.36]} rotation={[0.2, -0.5, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.16, 8]} />
        </mesh>
        {/* 聽診器 */}
        <mesh material={m.steth} position={[0, 0.16, 0.06]} rotation={[Math.PI / 2 - 0.7, 0, Math.PI]}>
          <torusGeometry args={[0.27, 0.024, 10, 40, Math.PI]} />
        </mesh>
        <mesh material={m.steth} position={[0.13, -0.05, 0.36]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.2, 8]} />
        </mesh>
        <mesh material={m.metal} position={[0.13, -0.16, 0.38]} rotation={[Math.PI / 2 - 0.2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.03, 20]} />
        </mesh>
        {/* 手臂（袖子＋爪子） */}
        <group ref={armR} position={[0.42, 0.08, 0.02]}>
          <mesh material={m.coat} position={[0.05, -0.18, 0]} rotation={[0, 0, 0.1]}>
            <capsuleGeometry args={[0.1, 0.22, 8, 12]} />
          </mesh>
          <mesh material={m.fur} position={[0.08, -0.38, 0.02]}>
            <sphereGeometry args={[0.09, 16, 16]} />
          </mesh>
        </group>
        <group ref={armL} position={[-0.42, 0.08, 0.02]}>
          <mesh material={m.coat} position={[-0.05, -0.18, 0]} rotation={[0, 0, -0.1]}>
            <capsuleGeometry args={[0.1, 0.22, 8, 12]} />
          </mesh>
          <mesh material={m.fur} position={[-0.08, -0.38, 0.02]}>
            <sphereGeometry args={[0.09, 16, 16]} />
          </mesh>
        </group>
        {/* 腳 */}
        {[-0.2, 0.2].map((x) => (
          <mesh key={x} material={m.furDark} position={[x, -0.6, 0.12]} scale={[1, 0.55, 1.3]}>
            <sphereGeometry args={[0.12, 16, 16]} />
          </mesh>
        ))}

        {/* 頭 */}
        <group ref={head} position={[0, 0.62, 0]}>
          <mesh material={m.fur} scale={[1.05, 0.92, 0.95]}>
            <sphereGeometry args={[0.42, 32, 32]} />
          </mesh>
          {/* 耳朵 */}
          {[-1, 1].map((s, i) => (
            <mesh
              key={s}
              ref={(el) => {
                if (el) ears.current[i] = el;
              }}
              material={m.furDark}
              position={[s * 0.36, 0.2, -0.02]}
              scale={[1, 1, 0.6]}
            >
              <sphereGeometry args={[0.085, 16, 16]} />
            </mesh>
          ))}
          {/* 臉：奶油色口鼻部、臉頰 */}
          <mesh material={m.cream} position={[0, -0.1, 0.24]} scale={[1.15, 0.78, 0.8]}>
            <sphereGeometry args={[0.24, 28, 28]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} material={m.cheek} position={[s * 0.24, -0.06, 0.32]} scale={[1, 0.6, 0.3]}>
              <sphereGeometry args={[0.06, 16, 16]} />
            </mesh>
          ))}
          {/* 眼睛 */}
          {[-1, 1].map((s, i) => (
            <group
              key={s}
              ref={(el) => {
                if (el) eyes.current[i] = el;
              }}
              position={[s * 0.15, 0.12, 0.34]}
            >
              <group
                ref={(el) => {
                  if (el) pupils.current[i] = el;
                }}
              >
                <mesh material={m.eye}>
                  <sphereGeometry args={[0.058, 20, 20]} />
                </mesh>
                <mesh material={m.shine} position={[0.02, 0.022, 0.048]}>
                  <sphereGeometry args={[0.016, 10, 10]} />
                </mesh>
              </group>
            </group>
          ))}
          {/* 眉毛（group 轉角度、裡面的膠囊橫躺） */}
          {[-1, 1].map((s, i) => (
            <group
              key={s}
              ref={(el) => {
                if (el) brows.current[i] = el;
              }}
              position={[s * 0.15, 0.24, 0.33]}
            >
              <mesh material={m.furDark} rotation={[0, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.014, 0.07, 4, 8]} />
              </mesh>
            </group>
          ))}
          {/* 鼻子、嘴 */}
          <mesh material={m.nose} position={[0, -0.02, 0.43]} scale={[1.4, 0.9, 0.8]}>
            <sphereGeometry args={[0.05, 20, 20]} />
          </mesh>
          <mesh ref={mouth} material={m.mouth} position={[0, -0.14, 0.4]} scale={[1, 0.2, 0.5]}>
            <sphereGeometry args={[0.045, 16, 16]} />
          </mesh>
          {whiskers}
          {/* 額鏡（醫生的反光鏡） */}
          <group position={[0, 0.33, 0.27]} rotation={[-0.35, 0, 0]}>
            <mesh material={m.metal} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.1, 0.1, 0.02, 32]} />
            </mesh>
            <mesh material={m.eye} position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.025, 0.025, 0.01, 16]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

export default function Otter3D({ state, mood, reduceMotion }: Props) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.3, 4.1], fov: 32 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      aria-label="Dr.Claude 水獺醫生"
      role="img"
    >
      <hemisphereLight args={['#ffffff', '#c9d6e8', 1.6]} />
      <directionalLight position={[2, 3, 4]} intensity={1.6} />
      <directionalLight position={[-3, 1, -2]} intensity={0.5} color="#b8cdf0" />
      <Otter state={state} mood={mood} reduceMotion={reduceMotion} />
    </Canvas>
  );
}
