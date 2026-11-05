// Dr.水獺：海獺醫生（原創角色，模型在 seaOtter.ts）。
// 狀態 state 決定身體動作：idle 待機（漂浮、眨眼、偶爾洗臉）、listening 聽（雙手捧臉頰）、thinking 想（抱著膠囊歪頭）、talking 說話。
// 表情 mood：待機時 happy 拍手、concerned／urgent 雙手合在胸前皺眉；其他狀態只改眉毛（urgent 身體往前傾）。
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Mood } from '../../shared/apiTypes';
import { addLights, buildSeaOtter, type PoseName } from './seaOtter';

export type OtterState = 'idle' | 'listening' | 'thinking' | 'talking';

interface Props {
  state: OtterState;
  mood: Mood | '';
  reduceMotion?: boolean;
  dark?: boolean;
}

function poseFor(state: OtterState, mood: Mood | ''): PoseName {
  if (state !== 'idle') return state;
  if (mood === 'happy') return 'happy';
  if (mood === 'concerned' || mood === 'urgent') return 'concerned';
  return 'idle';
}

/** 手機上毛少幾層（GPU 比較弱） */
const shellCount = () => (window.matchMedia('(pointer: coarse)').matches ? 8 : 12);

function Scene({ state, mood, reduceMotion, dark = false }: Props) {
  const { gl, scene } = useThree();
  const otter = useMemo(() => buildSeaOtter({ dark, shells: shellCount() }), [dark]);

  useEffect(() => {
    const lights = addLights(scene, dark);
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.35;
    return () => {
      scene.remove(...lights);
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, dark]);

  useEffect(() => () => otter.dispose(), [otter]);

  useEffect(() => {
    otter.setPose(poseFor(state, mood), { worried: mood === 'concerned' || mood === 'urgent', urgent: mood === 'urgent' });
  }, [otter, state, mood]);

  useFrame(({ clock, pointer }, delta) => {
    otter.update(clock.elapsedTime, Math.min(delta, 0.1), { look: { x: pointer.x, y: pointer.y }, calm: reduceMotion });
  });

  return <primitive object={otter.root} />;
}

export default function Otter3D(props: Props) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.32, 3.9], fov: 28 }}
      // 建構參數＋renderer 屬性（R3F 兩種都吃）；水面以下靠 clipping 切掉
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power', toneMapping: THREE.NeutralToneMapping, localClippingEnabled: true } as never}
      onCreated={({ camera }) => camera.lookAt(0, 0.02, 0)}
      aria-label="Dr.水獺"
      role="img"
    >
      <Scene {...props} />
    </Canvas>
  );
}
