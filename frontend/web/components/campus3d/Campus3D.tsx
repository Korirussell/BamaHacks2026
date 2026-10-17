'use client';
/**
 * 3D UA campus in the Kickoff Classic sticker style (campus3d.md).
 * Real building footprints from OpenStreetMap (public/campus/campus.json, fetched by scripts/fetch-campus.mjs).
 * The football replay ends in Katelyn's Touchdown celebration.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Float, Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useTheme } from 'next-themes';
import { KEY_LABELS, LABEL_ALIAS, PLACE_LABEL, PLACE_MAP } from './placeMap';

type Pt = [number, number];
type Campus = { buildings: { id: number; name: string; h: number; pts: Pt[] }[]; roads: { w: number; pts: Pt[] }[]; greens: { name: string; kind: string; pts: Pt[] }[]; water: { pts: Pt[] }[] };
export type Pin3D = { id: string; placeId: string; label: string; count?: number; emoji?: string };
export type Pillar3D = { id: string; placeId: string; rank: number; label: string; selected?: boolean };
export type Campus3DProps = {
  mode: 'history' | 'meetup' | 'hero' | 'focus';
  pins?: Pin3D[];
  pillars?: Pillar3D[];
  focusPlaceId?: string | null;
  onPinClick?: (id: string) => void;
  onPillarClick?: (id: string) => void;
  replay?: { fromPlaceId: string; toPlaceId: string; key: number } | null;
  onReplayEnd?: () => void;
  /** Force light/dark instead of reading next-themes (used by the embed route, map-plan.md §3). */
  theme?: 'light' | 'dark';
  /** false disables OrbitControls + auto-rotate and switches the canvas to frameloop="demand". */
  interactive?: boolean;
  /** false hides all building sticker labels except the focused place. */
  showLabels?: boolean;
  /** Directional light shadow map resolution; embed route uses 1024 for mobile perf. */
  shadowMapSize?: number;
  /** Chromeless: no rounded corners / border / "drag to orbit" badge, for full-bleed iOS embedding. */
  embedded?: boolean;
  onReady?: () => void;
  onError?: (message: string) => void;
};

const centroid = (pts: Pt[]): Pt => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const hash = (n: number) => ((n * 2654435761) >>> 0) % 3;

function palette(dark: boolean) {
  return dark
    ? { ground: '#1F2A24', green: '#25362C', road: '#2D3A32', water: '#2B4A63', buildings: ['#2A2224', '#33292B', '#3A2E2A'], edge: '#F7EFE6', crimson: '#D62B47' }
    : { ground: '#B9F0D0', green: '#9EE3BC', road: '#FFFFFF', water: '#9CD3F0', buildings: ['#FFE3D6', '#FFFFFF', '#FFF1B8'], edge: '#1A1414', crimson: '#9E1B32' };
}

function shapeFrom(pts: Pt[]) {
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  return s;
}

function useCampus() {
  const [data, setData] = useState<Campus | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch('/campus/campus.json').then(r => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setErr(true));
  }, []);
  return { data, err };
}

export function placePosition(data: Campus | null, placeId: string): THREE.Vector3 {
  const m = PLACE_MAP[placeId];
  let p: Pt = m?.fallback ?? [0, 0];
  let h = 10;
  if (data && m?.name) {
    const b = data.buildings.find(b => b.name.toLowerCase().includes(m.name!));
    if (b) { p = centroid(b.pts); h = b.h; }
  } else if (data && m?.green) {
    const g = data.greens.find(g => g.name.toLowerCase().includes(m.green!));
    if (g) p = centroid(g.pts);
  }
  if (m?.offset) p = [p[0] + m.offset[0], p[1] + m.offset[1]];
  return new THREE.Vector3(p[0], h, p[1]);
}

function Ground({ data, dark }: { data: Campus; dark: boolean }) {
  const c = palette(dark);
  const { greens, water, roads } = useMemo(() => {
    const flat = (polys: { pts: Pt[] }[]) => {
      const gs = polys.filter(p => p.pts.length > 2).map(p => new THREE.ShapeGeometry(shapeFrom(p.pts)));
      return gs.length ? mergeGeometries(gs, false) : null;
    };
    // Road ribbons: one quad per segment, merged into a single buffer.
    const pos: number[] = [];
    for (const r of data.roads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1;
        const nx = (-dz / L) * (r.w / 2), nz = (dx / L) * (r.w / 2);
        pos.push(x1 + nx, 0, z1 + nz, x2 + nx, 0, z2 + nz, x2 - nx, 0, z2 - nz, x1 + nx, 0, z1 + nz, x2 - nx, 0, z2 - nz, x1 - nx, 0, z1 - nz);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.computeVertexNormals();
    return { greens: flat(data.greens.filter(g => g.kind !== 'stadium')), water: flat(data.water), roads: rg };
  }, [data]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[6000, 6000]} />
        <meshLambertMaterial color={c.ground} />
      </mesh>
      {greens && <mesh geometry={greens} rotation-x={-Math.PI / 2} position-y={0.2} receiveShadow><meshLambertMaterial color={c.green} /></mesh>}
      {water && <mesh geometry={water} rotation-x={-Math.PI / 2} position-y={0.25}><meshLambertMaterial color={c.water} /></mesh>}
      <mesh geometry={roads} position-y={0.35} receiveShadow><meshLambertMaterial color={c.road} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

function Buildings({ data, dark }: { data: Campus; dark: boolean }) {
  const c = palette(dark);
  const groups = useMemo(() => {
    const buckets: THREE.BufferGeometry[][] = [[], [], []];
    for (const b of data.buildings) {
      if (b.pts.length < 3 || /denny chimes/i.test(b.name)) continue;
      const g = new THREE.ExtrudeGeometry(shapeFrom(b.pts), { depth: b.h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      buckets[hash(b.id)].push(g);
    }
    return buckets.map(list => {
      const merged = mergeGeometries(list, false)!;
      return { mesh: merged, edges: new THREE.EdgesGeometry(merged, 15) };
    });
  }, [data]);
  return (
    <group>
      {groups.map((g, i) => (
        <group key={i}>
          <mesh geometry={g.mesh} castShadow receiveShadow><meshLambertMaterial color={c.buildings[i]} /></mesh>
          <lineSegments geometry={g.edges}><lineBasicMaterial color={c.edge} /></lineSegments>
        </group>
      ))}
    </group>
  );
}

function Landmarks({ data, dark }: { data: Campus; dark: boolean }) {
  const c = palette(dark);
  const chimes = data.buildings.find(b => /denny chimes/i.test(b.name));
  const stadium = data.greens.find(g => /bryant.?denny/i.test(g.name));
  const st = stadium ? centroid(stadium.pts) : null;
  const stR = stadium ? Math.max(...stadium.pts.map(p => Math.hypot(p[0] - st![0], p[1] - st![1]))) * 0.8 : 0;
  const ch = chimes ? centroid(chimes.pts) : null;
  return (
    <group>
      {ch && (
        <group position={[ch[0], 0, ch[1]]}>
          <mesh position-y={17} castShadow><boxGeometry args={[6, 34, 6]} /><meshLambertMaterial color={dark ? '#3A2E2A' : '#FFFFFF'} /></mesh>
          <mesh position-y={38}><coneGeometry args={[5, 9, 4]} /><meshLambertMaterial color={c.crimson} /></mesh>
          <lineSegments position-y={17}><edgesGeometry args={[new THREE.BoxGeometry(6, 34, 6)]} /><lineBasicMaterial color={c.edge} /></lineSegments>
          <Label text="Denny Chimes" y={46} />
        </group>
      )}
      {st && (
        <group position={[st[0], 0, st[1]]} scale={[1, 1, 0.78]}>
          <mesh position-y={20} castShadow><cylinderGeometry args={[stR, stR * 0.78, 40, 48, 1, true]} /><meshLambertMaterial color={dark ? '#33292B' : '#FFFFFF'} side={THREE.DoubleSide} /></mesh>
          <mesh position-y={40}><torusGeometry args={[stR, 2.5, 8, 48]} /><meshLambertMaterial color={c.crimson} /></mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.6}><circleGeometry args={[stR * 0.7, 48]} /><meshLambertMaterial color="#5BBF6A" /></mesh>
          <Label text="Bryant-Denny Stadium" y={56} />
        </group>
      )}
    </group>
  );
}

function Label({ text, y = 20, onClick }: { text: string; y?: number; onClick?: () => void }) {
  return (
    <Html position={[0, y, 0]} center distanceFactor={520} zIndexRange={[20, 0]}>
      <span onClick={onClick} className="pointer-events-auto block whitespace-nowrap rounded-full border-2 border-[#1A1414] bg-[#FFD84D] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#1A1414] shadow-[3px_3px_0_#1A1414]">
        {text}
      </span>
    </Html>
  );
}

function KeyLabels({ data, showLabels, focusPlaceId }: { data: Campus; showLabels: boolean; focusPlaceId?: string | null }) {
  const items = useMemo(() => {
    const seen = new Set<string>();
    return data.buildings
      .filter(b => { const n = b.name.toLowerCase(); const k = KEY_LABELS.find(k => n.includes(k)); if (!k || seen.has(k) || k === 'denny chimes') return false; seen.add(k); return true; })
      .map(b => ({ id: b.id, p: centroid(b.pts), h: b.h, name: LABEL_ALIAS[KEY_LABELS.find(k => b.name.toLowerCase().includes(k))!] ?? b.name }));
  }, [data]);
  if (!showLabels) {
    // labels=0 (map-plan.md §3): hide every building label except the one the map is focused on.
    if (!focusPlaceId) return null;
    const pos = placePosition(data, focusPlaceId);
    return <group position={[pos.x, 0, pos.z]}><Label text={PLACE_LABEL[focusPlaceId] ?? focusPlaceId} y={pos.y + 10} /></group>;
  }
  return <>{items.map(i => <group key={i.id} position={[i.p[0], 0, i.p[1]]}><Label text={i.name} y={i.h + 10} /></group>)}</>;
}

function PinMesh({ pos, pin, color, onClick, active }: { pos: THREE.Vector3; pin: Pin3D; color: string; onClick?: () => void; active: boolean }) {
  return (
    <group position={[pos.x, pos.y + 34, pos.z]}>
      <Float speed={2} floatIntensity={active ? 8 : 3} rotationIntensity={0}>
        <group scale={active ? 3 : 2.2} onClick={e => { e.stopPropagation(); onClick?.(); }}>
          <mesh position-y={18}><sphereGeometry args={[9, 20, 20]} /><meshLambertMaterial color={color} emissive={color} emissiveIntensity={0.25} /></mesh>
          <mesh position-y={7} rotation-x={Math.PI}><coneGeometry args={[7.5, 16, 20]} /><meshLambertMaterial color={color} emissive={color} emissiveIntensity={0.25} /></mesh>
          <mesh position-y={18}><sphereGeometry args={[3.5, 12, 12]} /><meshBasicMaterial color="#FFFFFF" /></mesh>
          {(pin.count ?? 0) > 1 && (
            <Html position={[12, 32, 0]} center distanceFactor={520}>
              <span className="rounded-full border-2 border-[#1A1414] bg-[#FFD84D] px-1.5 text-[11px] font-extrabold text-[#1A1414]">×{pin.count}</span>
            </Html>
          )}
          {(
            <Html position={[0, 44, 0]} center distanceFactor={520} style={{ opacity: active ? 1 : 0, transition: 'opacity 150ms', pointerEvents: 'none' }}>
              <span className="whitespace-nowrap rounded-full border-2 border-[#1A1414] bg-white px-2.5 py-1 text-[12px] font-extrabold text-[#1A1414] shadow-[3px_3px_0_#1A1414]">{pin.emoji} {pin.label}</span>
            </Html>
          )}
        </group>
      </Float>
    </group>
  );
}

function Pillar({ pos, p, color, onClick }: { pos: THREE.Vector3; p: Pillar3D; color: string; onClick?: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const t0 = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (t0.current == null) t0.current = clock.elapsedTime;
    const k = Math.min(1, (clock.elapsedTime - t0.current) / 1.2);
    const pulse = p.selected ? 1 + Math.sin(clock.elapsedTime * 4) * 0.08 : 1;
    ref.current.scale.set(pulse, Math.max(0.001, 1 - Math.pow(1 - k, 3)), pulse);
  });
  return (
    <group position={[pos.x, 0, pos.z]} onClick={e => { e.stopPropagation(); onClick?.(); }}>
      <group ref={ref}>
        <mesh position-y={60}><cylinderGeometry args={[p.selected ? 16 : 11, p.selected ? 16 : 11, 120, 24, 1, true]} /><meshBasicMaterial color={color} transparent opacity={p.selected ? 0.75 : 0.45} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      </group>
      <Html position={[0, 138, 0]} center distanceFactor={520}>
        <button onClick={onClick} className={`flex flex-col items-center rounded-[14px] border-2 border-[#1A1414] px-2.5 py-1 shadow-[3px_3px_0_#1A1414] ${p.selected ? 'bg-[#FFD84D]' : 'bg-white'}`}>
          <span className="font-display text-[18px] font-bold leading-none text-[#1A1414]">{p.rank}</span>
          <span className="whitespace-nowrap text-[10px] font-extrabold uppercase text-[#1A1414]">{p.label}</span>
        </button>
      </Html>
    </group>
  );
}

function Football({ from, to, onEnd }: { from: THREE.Vector3; to: THREE.Vector3; onEnd?: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const t0 = useRef<number | null>(null);
  const done = useRef(false);
  const curve = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5);
    mid.y = Math.max(from.y, to.y) + 80 + from.distanceTo(to) * 0.15;
    return new THREE.QuadraticBezierCurve3(from.clone().setY(from.y + 20), mid, to.clone().setY(to.y + 20));
  }, [from, to]);
  const pts = useMemo(() => curve.getPoints(40), [curve]);
  const [ring, setRing] = useState(0);
  useFrame(({ clock }, dt) => {
    if (t0.current == null) t0.current = clock.elapsedTime;
    const k = Math.min(1, (clock.elapsedTime - t0.current) / 1.4);
    const p = curve.getPoint(k);
    if (ref.current) { ref.current.position.copy(p); ref.current.rotation.z += dt * 12; ref.current.lookAt(curve.getPoint(Math.min(1, k + 0.02))); }
    if (k >= 1 && !done.current) { done.current = true; setRing(1); setTimeout(() => onEnd?.(), 450); }
    if (done.current) setRing(r => Math.min(r + dt * 2.5, 2));
  });
  return (
    <group>
      <Line points={pts} color="#FFD84D" lineWidth={3} dashed dashSize={8} gapSize={6} />
      <group ref={ref}>
        <mesh scale={[1, 0.62, 0.62]}><sphereGeometry args={[9, 20, 14]} /><meshLambertMaterial color="#8A4B2A" /></mesh>
        <mesh position={[0, 5.4, 0]}><boxGeometry args={[9, 0.8, 0.8]} /><meshBasicMaterial color="#FFFFFF" /></mesh>
      </group>
      {ring > 0 && (
        <mesh position={[to.x, 1, to.z]} rotation-x={-Math.PI / 2} scale={1 + ring * 30}>
          <ringGeometry args={[0.8, 1, 48]} />
          <meshBasicMaterial color="#FFD84D" transparent opacity={Math.max(0, 1 - ring / 2)} />
        </mesh>
      )}
    </group>
  );
}

function CameraRig({ focus, intro, far }: { focus: THREE.Vector3 | null; intro: boolean; far?: boolean }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const start = useRef<number | null>(null);
  const home = useMemo(() => ({ pos: new THREE.Vector3(-480, 470, 600), target: new THREE.Vector3(-120, 0, -150) }), []);
  useFrame(({ clock }) => {
    if (!controls) return;
    if (start.current == null) start.current = clock.elapsedTime;
    const t = clock.elapsedTime - start.current;
    if (intro && t < 1.6) {
      const k = 1 - Math.pow(1 - t / 1.6, 3);
      camera.position.lerpVectors(new THREE.Vector3(-1600, 2200, 2400), home.pos, k);
      controls.target.copy(home.target);
      controls.update();
      return;
    }
    if (focus) {
      controls.target.lerp(focus, 0.06);
      const want = focus.clone().add(far ? new THREE.Vector3(-320, 420, 520) : new THREE.Vector3(-200, 240, 300));
      camera.position.lerp(want, 0.04);
      controls.update();
    }
  });
  return null;
}

function Scene(props: Campus3DProps & { data: Campus; dark: boolean }) {
  const { data, dark, pins = [], pillars = [], focusPlaceId, replay, onReplayEnd, onPinClick, onPillarClick, interactive = true, showLabels = true, shadowMapSize = 2048 } = props;
  const c = palette(dark);
  const [interacted, setInteracted] = useState(false);
  const focus = useMemo(() => (focusPlaceId ? placePosition(data, focusPlaceId).setY(0) : null), [data, focusPlaceId]);
  const selected = pillars.find(p => p.selected);
  const selId = selected?.placeId;
  const pillarKey = pillars.map(p => p.placeId).join(',');
  const pillarFocus = useMemo(() => {
    if (!pillars.length) return null;
    const pts = pillars.map(p => placePosition(data, p.placeId).setY(0));
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    return selId ? c.lerp(placePosition(data, selId).setY(0), 0.35) : c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selId, pillarKey]);
  return (
    <>
      <hemisphereLight args={[dark ? '#6b6080' : '#ffffff', dark ? '#1F2A24' : '#B9F0D0', dark ? 0.9 : 1.1]} />
      <directionalLight position={[-500, 800, 400]} intensity={dark ? 0.6 : 1.1} castShadow shadow-mapSize={[shadowMapSize, shadowMapSize]} shadow-camera-left={-1200} shadow-camera-right={1200} shadow-camera-top={1200} shadow-camera-bottom={-1200} shadow-camera-far={3000} />
      <Ground data={data} dark={dark} />
      <Buildings data={data} dark={dark} />
      <Landmarks data={data} dark={dark} />
      {props.mode !== 'hero' && <KeyLabels data={data} showLabels={showLabels} focusPlaceId={focusPlaceId} />}
      {pins.map(p => <PinMesh key={p.id} pin={p} pos={placePosition(data, p.placeId)} color={c.crimson} active={focusPlaceId === p.placeId} onClick={() => onPinClick?.(p.id)} />)}
      {pillars.map(p => <Pillar key={p.id} p={p} pos={placePosition(data, p.placeId)} color={c.crimson} onClick={() => onPillarClick?.(p.id)} />)}
      {replay && <Football key={replay.key} from={placePosition(data, replay.fromPlaceId)} to={placePosition(data, replay.toPlaceId)} onEnd={onReplayEnd} />}
      <OrbitControls
        makeDefault
        enabled={interactive}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={(25 * Math.PI) / 180}
        maxPolarAngle={(65 * Math.PI) / 180}
        minDistance={250}
        maxDistance={2200}
        autoRotate={interactive && !interacted && !focus && !pillarFocus}
        autoRotateSpeed={0.3}
        onStart={() => setInteracted(true)}
      />
      <CameraRig focus={focus ?? pillarFocus} intro far={!focus && !!pillarFocus} />
    </>
  );
}

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export default function Campus3D(props: Campus3DProps & { fallback?: React.ReactNode }) {
  const { data, err } = useCampus();
  const { resolvedTheme } = useTheme();
  const [gl, setGl] = useState<boolean | null>(null);
  useEffect(() => setGl(hasWebGL()), []);
  const dark = props.theme ? props.theme === 'dark' : resolvedTheme === 'dark';
  const { onReady, onError, embedded, interactive = true } = props;
  // Guard with refs (not just effect deps) so a non-memoized onReady/onError prop from the
  // caller can't make these re-fire on every unrelated re-render once the condition is already true.
  const firedReady = useRef(false);
  const firedGlError = useRef(false);
  const firedDataError = useRef(false);
  useEffect(() => { if (gl === false && !firedGlError.current) { firedGlError.current = true; onError?.('WebGL unavailable'); } }, [gl, onError]);
  useEffect(() => { if (err && !firedDataError.current) { firedDataError.current = true; onError?.('Failed to load campus data'); } }, [err, onError]);
  useEffect(() => { if (data && gl && !firedReady.current) { firedReady.current = true; onReady?.(); } }, [data, gl, onReady]);
  if (gl === false || err) return <>{props.fallback}</>;
  return (
    <div className={`stk relative h-full w-full overflow-hidden ${embedded ? '' : 'rounded-[24px]'}`} style={{ background: dark ? '#161213' : '#E8F7EE' }}>
      {!data && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="stk-sm rounded-[18px] bg-card px-5 py-4 text-center">
            <p className="font-display text-[18px] font-bold">Building campus… 🏗️</p>
            <div className="mt-2 h-2.5 w-40 overflow-hidden rounded-full border-2 border-ink bg-sunk"><div className="skel h-full w-2/3 bg-butter" /></div>
          </div>
        </div>
      )}
      {data && gl && (
        <Canvas flat shadows dpr={[1, 2]} frameloop={interactive ? 'always' : 'demand'} camera={{ fov: 35, near: 5, far: 9000, position: [-1600, 2200, 2400] }} onCreated={({ gl }) => gl.setClearColor(dark ? '#161213' : '#E8F7EE')}>
          <fog attach="fog" args={[dark ? '#161213' : '#E8F7EE', 3200, 6500]} />
          <Suspense fallback={null}>
            <Scene {...props} data={data} dark={dark} />
          </Suspense>
        </Canvas>
      )}
      {!embedded && <span className="pointer-events-none absolute bottom-3 left-4 rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[10.5px] font-extrabold uppercase">University of Alabama · drag to orbit</span>}
    </div>
  );
}
