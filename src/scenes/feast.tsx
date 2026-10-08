import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, useGLTF } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SITE } from "../content";
import type { Pour } from "../lib";
import { Backdrop, M, Ready, Table, flick, prep, useNode, type Flame } from "./real";
import { Kadhai, Kulhad, VESSELS } from "./pour";
import { Steam, rng, smooth, type SceneProps } from "./kit";

/*
 * Photoreal still life that is alive from the first frame: a filled brass
 * kadhai (or a row of kulhads) simmering on a walnut table, steam rising, a
 * lit diya lantern and a handi behind, limes and pomegranate in front. The
 * camera glides in on load and pushes in on scroll; nothing waits for input.
 * No vignette or other screen-space falloff: the photo backdrop is the only
 * background. Units are metres; the table top is y = 0.
 */

const POUR: Pour = SITE.pour ?? { from: "pan", into: "kadhai", liquid: "#8a3418", foam: "#d9864a", thick: 1.6 };
const CUPS = POUR.into !== "kadhai";
const V = VESSELS[CUPS ? "kulhad" : "kadhai"];
const LEVEL = CUPS ? 0.074 : 0.078;
const lum = new THREE.Color(POUR.liquid);
const KHEER = CUPS && (lum.r + lum.g + lum.b) / 3 > 0.7;
// cups sit at 1.5x and the camera works at this fraction of the kadhai framing
const CUP_SCALE = 1.5;
const FRAME = CUPS ? 0.82 : 1;

["brass_pot_01", "brass_pot_02", "brass_diya_lantern", "food_lime_01", "food_pomegranate_01"].forEach((n) => useGLTF.preload(M(n)));

/* ---------- the food surface: a polar grid with simmer bubbles and baked colour ---------- */

function disc(rings: number, seg: number) {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let r = 1; r <= rings; r++)
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * (r / rings), 0, Math.sin(a) * (r / rings));
    }
  const at = (r: number, s: number) => (r === 0 ? 0 : 1 + (r - 1) * seg + (s % seg));
  for (let s = 0; s < seg; s++) idx.push(0, at(1, s + 1), at(1, s));
  for (let r = 1; r < rings; r++)
    for (let s = 0; s < seg; s++) {
      const a = at(r, s), b = at(r, s + 1), c = at(r + 1, s), d = at(r + 1, s + 1);
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

type Bubble = { x: number; z: number; t: number; a: number; w: number };

function Food({ R, seed, still, rings = 30, seg = 72 }: { R: number; seed: number; still: boolean; rings?: number; seg?: number }) {
  const geo = useMemo(() => {
    const g = disc(rings, seg);
    const p = g.attributes.position.array as Float32Array;
    const col = new Float32Array(p.length);
    const base = new THREE.Color(POUR.liquid);
    const foam = new THREE.Color(POUR.foam);
    const fleck = base.clone().multiplyScalar(0.55);
    const c = new THREE.Color();
    const r = rng(seed * 17 + 3);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], z = p[i + 2];
      const rad = Math.hypot(x, z);
      const ang = Math.atan2(z, x);
      // slow, uneven tone so it reads as food rather than paint
      const n = Math.sin(x * 9 + Math.sin(z * 7 + seed)) * 0.5 + Math.sin(z * 13 - x * 5) * 0.3;
      c.copy(base).multiplyScalar((CUPS || KHEER ? 0.93 : 0.62) + n * 0.07);
      if (CUPS && !KHEER) {
        // chai: a pale froth ring clinging to the clay
        c.lerp(foam, smooth(0.62, 0.98, rad) * 0.7 + (r() < 0.25 ? 0.15 : 0));
      } else if (KHEER) {
        c.lerp(foam, Math.max(0, n) * 0.25);
      } else {
        // gravy: a ring of tari (oil) at the rim and specks of masala
        c.lerp(foam, smooth(0.78, 1, rad) * 0.45);
        if (r() < 0.07) c.lerp(fleck, 0.8);
        // a cream swirl through the middle
        if (POUR.butter) c.lerp(new THREE.Color("#f4e2c0"), smooth(0.72, 0.97, Math.sin(ang + rad * 15)) * (1 - smooth(0.35, 0.6, rad)) * 0.4);
      }
      col[i] = c.r;
      col[i + 1] = c.g;
      col[i + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [rings, seg, seed]);
  const base = useMemo(() => (geo.attributes.position.array as Float32Array).slice(), [geo]);
  const bubbles = useRef<Bubble[]>([]);
  const next = useRef(0);
  const r = useMemo(() => rng(seed * 101 + 7), [seed]);
  const thick = POUR.thick > 1.3;

  useFrame(({ clock }) => {
    if (still) return;
    const t = clock.elapsedTime;
    if (t > next.current) {
      // gravies blip slowly; chai and kheer barely move
      const rate = CUPS ? 1.1 : 0.32;
      next.current = t + rate * (0.4 + r());
      const a = Math.sqrt(r()) * 0.72;
      const th = r() * Math.PI * 2;
      bubbles.current.push({ x: Math.cos(th) * a, z: Math.sin(th) * a, t, a: (CUPS ? 0.006 : thick ? 0.03 : 0.018) * (0.6 + r() * 0.6), w: CUPS ? 0.05 : 0.045 + r() * 0.03 });
      bubbles.current = bubbles.current.filter((b) => t - b.t < 1.8);
    }
    const pos = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = base[i], z = base[i + 2];
      // a slow heave over the whole pot, pinned at the wall
      let h = Math.sin(t * 0.9 + x * 6) * Math.cos(t * 0.7 + z * 5) * 0.004;
      for (const b of bubbles.current) {
        const age = t - b.t;
        const d = Math.hypot(x - b.x, z - b.z);
        if (age < 0.55) h += b.a * Math.sin((Math.PI * age) / 0.55) * Math.exp(-((d / b.w) ** 2));
        else h += (b.a * 0.5 * Math.exp(-5 * (age - 0.55)) * Math.sin(70 * d - 30 * (age - 0.55))) / (1 + 25 * d);
      }
      pos[i + 1] = h * (1 - Math.pow(Math.hypot(x, z), 6));
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  });

  return (
    <mesh geometry={geo} scale={[R, R, R]} receiveShadow>
      <meshPhysicalMaterial vertexColors roughness={thick ? 0.5 : 0.28} clearcoat={CUPS && !KHEER ? 0.3 : KHEER ? 0.6 : 0.15} clearcoatRoughness={0.25} sheen={KHEER ? 0.5 : 0} specularIntensity={CUPS || KHEER ? 1 : 0.2} envMapIntensity={CUPS || KHEER ? 0.45 : 0.15} />
    </mesh>
  );
}

/** Coriander on gravy, pistachio and saffron on kheer, nothing on chai. */
function Garnish({ R, y }: { R: number; y: number }) {
  const bits = useMemo(() => {
    if (CUPS && !KHEER) return [];
    const r = rng(41);
    const out: { x: number; z: number; rot: number; s: [number, number]; color: string }[] = [];
    const n = KHEER ? 9 : 16;
    for (let i = 0; i < n; i++) {
      const a = Math.sqrt(r()) * R * 0.6;
      const th = r() * Math.PI * 2;
      const saffron = KHEER && i % 3 === 0;
      out.push({
        x: Math.cos(th) * a,
        z: Math.sin(th) * a,
        rot: r() * Math.PI,
        s: saffron ? [0.0012, 0.009] : KHEER ? [0.0035, 0.002] : [0.0075 + r() * 0.003, 0.006 + r() * 0.002],
        color: saffron ? "#c8401a" : KHEER ? "#8bab4a" : r() > 0.5 ? "#3f7d2b" : "#2f6a22",
      });
    }
    return out;
  }, [R]);
  return (
    <group position-y={y + 0.0025}>
      {bits.map((b, i) => (
        <mesh key={i} position={[b.x, 0, b.z]} rotation={[-Math.PI / 2, 0, b.rot]} scale={[b.s[0], b.s[1], 1]}>
          <circleGeometry args={[1, 9]} />
          <meshStandardMaterial color={b.color} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** White butter melting on top of the gravy. */
function Butter({ y, still }: { y: number; still: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const k = still ? 0.6 : 1 - smooth(0, 40, clock.elapsedTime) * 0.5;
    m.scale.set(0.034 * (1.5 - k * 0.5), 0.016 * k, 0.03 * (1.5 - k * 0.5));
    m.position.y = y + 0.006 * k + Math.sin(clock.elapsedTime * 0.9) * 0.0008;
  });
  return (
    <mesh ref={ref} position={[0.012, y, -0.008]} rotation-y={0.5} castShadow>
      <sphereGeometry args={[1, 32, 16]} />
      <meshPhysicalMaterial color="#fff6dc" roughness={0.3} clearcoat={0.6} sheen={0.4} />
    </mesh>
  );
}

function Vessel({ still }: { still: boolean }) {
  const R = V.r(LEVEL) - V.inset;
  if (!CUPS)
    return (
      <group>
        <Kadhai />
        <group position-y={LEVEL}>
          <Food R={R} seed={1} still={still} />
        </group>
        <Garnish R={R} y={LEVEL} />
        {POUR.butter && <Butter y={LEVEL} still={still} />}
      </group>
    );
  // three kulhads: one front and centre, two behind it
  const spots: [number, number, number][] = [[0, 0, 0], [-0.13, 0, -0.1], [0.12, 0, -0.13]];
  return (
    <group>
      {spots.map((p, i) => (
        <group key={i} position={p} rotation-y={i * 2.1} scale={CUP_SCALE}>
          <Kulhad />
          <group position-y={LEVEL}>
            <Food R={R} seed={i + 1} still={still} rings={18} seg={48} />
          </group>
          {i === 0 && <Garnish R={R} y={LEVEL} />}
        </group>
      ))}
    </group>
  );
}

function Props({ flames }: { flames: Flame[] }) {
  const lantern = useNode("brass_diya_lantern");
  const handi = useNode("brass_pot_01");
  const lime = useNode("food_lime_01");
  const pom = useNode("food_pomegranate_01");
  const o = useMemo(() => {
    flames.length = 0;
    const l = prep(lantern, flames, 0.6, 1);
    // standing on the table: drop the hanging chain and seat the ring on the lid
    const chain = l.getObjectByName("brass_diya_lantern_chain");
    if (chain) chain.visible = false;
    const ring = l.getObjectByName("brass_diya_lantern_connection");
    if (ring) ring.position.y = 0.128;
    return {
      l,
      h: prep(handi, [], 0, 0),
      limes: [0, 1, 2].map(() => prep(lime, [], 0, 0)),
      poms: [0, 1].map(() => prep(pom, [], 0, 0)),
    };
  }, [lantern, handi, lime, pom, flames]);
  const w = CUPS ? 0.75 : 1;
  return (
    <group>
      <group position={[0.4 * w, 0, -0.3 * w]} rotation-y={0.6} scale={1.45}>
        <primitive object={o.l} />
        <pointLight ref={(n) => void (flames[0] && (flames[0].light = n))} position={[0.004, 0.055, -0.006]} color="#ff9f45" intensity={0} distance={1.8} decay={2} />
      </group>
      <primitive object={o.h} position={[-0.42 * w, 0, -0.34 * w]} rotation-y={0.5} />
      <primitive object={o.limes[0]} position={[0.27 * w, 0, 0.17]} rotation={[0, 1.1, 0]} />
      <primitive object={o.limes[1]} position={[0.34 * w, 0, 0.09]} rotation={[0, -0.4, 0]} />
      <primitive object={o.limes[2]} position={[0.31 * w, 0.03, 0.24]} rotation={[1.45, 0.2, 0.3]} />
      <primitive object={o.poms[0]} position={[-0.26 * w, 0, 0.18]} rotation={[0, 0.8, 0]} />
      <primitive object={o.poms[1]} position={[-0.35 * w, 0, 0.08]} rotation={[0.1, 2.3, -0.2]} scale={0.9} />
    </group>
  );
}

/** Camera glides in on load (the scene is already alive), then pushes in with scroll. */
function Director({ progress, side, still, flames }: Pick<SceneProps, "progress" | "side" | "still"> & { flames: Flame[] }) {
  const { size, pointer } = useThree();
  const start = useRef<number | null>(null);
  const look = useMemo(() => new THREE.Vector3(), []);
  const want = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, clock }, dt) => {
    const now = clock.elapsedTime;
    if (start.current === null) start.current = now;
    const t = still ? 99 : now - start.current;
    const intro = smooth(0, 3, t);
    const p = smooth(0, 1, progress.get());
    const narrow = size.width < 768;
    const F = FRAME;
    const off = (narrow ? 0 : side === "left" ? -0.36 : 0.36) * F;
    const cam = camera as THREE.PerspectiveCamera;
    const fov = narrow ? 38 : 30;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // high enough to see into the pot, low enough to keep the table's depth
    const dist = ((narrow ? 2.4 : 1.6) + (1 - intro) * 0.9 - p * 0.5) * F;
    const ang = (1 - intro) * 0.4 - p * 0.25 + (still ? 0 : pointer.x * 0.05);
    const y = ((narrow ? 1.05 : 0.78) + (1 - intro) * 0.25 - p * 0.18 + (still ? 0 : pointer.y * 0.03)) * F;
    const ox = off * (1 - p * 0.5);
    want.set(ox + Math.sin(ang) * dist, y, Math.cos(ang) * dist);
    camera.position.lerp(want, still ? 1 : 1 - Math.pow(0.02, dt));
    look.set(ox, (narrow ? -0.42 : 0.03) * F, 0);
    camera.lookAt(look);

    for (const f of flames) {
      const on = still ? 1 : smooth(f.at, f.at + 0.6, t);
      const k = flick(now, f.seed) * on;
      f.mat.emissiveIntensity = f.base * k;
      f.mat.opacity = on;
      if (f.light) f.light.intensity = 1.1 * k;
    }
  });
  return null;
}

export default function Feast({ progress, lite, still, side }: SceneProps) {
  const [ready, setReady] = useState(false);
  const flames = useMemo<Flame[]>(() => [], []);
  const backdrop = SITE.hero.backdrop ?? SITE.hero.fallback;
  const top = (CUPS ? CUP_SCALE : 1) * LEVEL;
  return (
    <Canvas
      shadows={!lite}
      frameloop={still ? "demand" : "always"}
      dpr={lite ? [1, 1.25] : [1, 1.75]}
      camera={{ position: [0.4, 1.1, 2.6], fov: 30, near: 0.05, far: 30 }}
      gl={{ antialias: !lite, alpha: true, powerPreference: "high-performance" }}
      style={{ touchAction: "pan-y", opacity: ready ? 1 : 0, transition: "opacity 1.2s cubic-bezier(.2,.7,.2,1)" }}
    >
      <Suspense fallback={null}>
        <Environment files="/hdr/warm_restaurant_night_1k.hdr" environmentIntensity={0.6} environmentRotation={[0, 2.2, 0]} />
        <Backdrop src={backdrop} progress={progress} blur={1.2} lum={0.8} />
        <Table lite={lite} mix={0.6} env={0.35} rough={0.78} />
        <Vessel still={still} />
        <Props flames={flames} />
        {(POUR.hot ?? true) && !KHEER && (
          <Steam
            count={12}
            origin={[0, top + 0.08, 0]}
            spread={CUPS ? 0.2 : 0.18}
            rise={0.45}
            size={CUPS ? 0.1 : 0.12}
            opacity={0.07}
            speed={0.16}
          />
        )}
        <ContactShadows position={[0, 0.001, 0]} scale={2} blur={2.2} far={0.5} opacity={0.75} frames={1} resolution={lite ? 256 : 512} />
        <spotLight
          position={[1.2, 2.2, 1.5]}
          angle={0.4}
          penumbra={0.85}
          intensity={7}
          color="#ffe6c7"
          castShadow={!lite}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0004}
        />
        <directionalLight position={[-2, 1.4, -2.5]} intensity={0.8} color={SITE.theme.accent} />
        <Director progress={progress} side={side} still={still} flames={flames} />
        {!lite && (
          <EffectComposer multisampling={0}>
            <Bloom mipmapBlur luminanceThreshold={1.2} intensity={0.45} radius={0.5} />
          </EffectComposer>
        )}
        <Ready onReady={() => setReady(true)} />
      </Suspense>
    </Canvas>
  );
}
