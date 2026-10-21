import type { CSSProperties } from "react";
import styles from "./ArenaScene.module.scss";

/**
 * Atmospheric illustration: a fight in the octagon seen from the stands. Drawn as inline SVG (works offline,
 * no external images), animated with CSS (spotlights, haze, camera flashes) that stops under reduced motion.
 * Decorative only.
 */

const CX = 800;
const CY = 640;
const RX = 300;
const RY = 118;
const FENCE = 92;

// Octagon in perspective: unit octagon scaled to an ellipse-like footprint.
const UNIT: [number, number][] = [
  [-0.414, -1],
  [0.414, -1],
  [1, -0.414],
  [1, 0.414],
  [0.414, 1],
  [-0.414, 1],
  [-1, 0.414],
  [-1, -0.414],
];
const OCT = UNIT.map(([x, y]) => [CX + x * RX, CY + y * RY] as const);
const pts = (list: readonly (readonly [number, number])[]) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

const FACES = OCT.map((p, i) => {
  const q = OCT[(i + 1) % OCT.length];
  return { d: pts([p, q, [q[0], q[1] - FENCE], [p[0], p[1] - FENCE]]), back: (p[1] + q[1]) / 2 < CY };
});

// Deterministic pseudo-random numbers: the picture is the same on server and client.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const r1 = rng(7);
const FRONT_ROW = Array.from({ length: 22 }, (_, i) => ({ x: i * 78 - 20 + r1() * 30, y: 935 + r1() * 40, s: 0.85 + r1() * 0.4 }));
const SECOND_ROW = Array.from({ length: 30 }, (_, i) => ({ x: i * 56 + r1() * 24, y: 862 + r1() * 24, s: 0.55 + r1() * 0.2 }));
const FLASHES = Array.from({ length: 26 }, () => {
  const a = r1() * Math.PI;
  const k = 0.62 + r1() * 0.33;
  return { x: CX + Math.cos(a + Math.PI) * 760 * k, y: CY - 40 - Math.sin(a) * 300 * k, d: (r1() * 6).toFixed(2) };
});
const PHONES = [3, 8, 13, 18].map((i) => FRONT_ROW[i]);

function Person({ x, y, s }: { x: number; y: number; s: number }) {
  // Head and shoulders seen from behind.
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <ellipse cx="0" cy="0" rx="22" ry="26" />
      <path d="M-58 90 C-56 40 -34 26 0 26 C34 26 56 40 58 90 Z" />
    </g>
  );
}

type Cap = [number, number, number, number, number];

// Limbs as tapered capsules: thigh thicker than calf, upper arm thicker than forearm.
const LEGS: Cap[] = [
  [-5, -58, -15, -30, 15],
  [-15, -30, -22, -4, 11],
  [5, -58, 14, -31, 15],
  [14, -31, 19, -4, 11],
];
const REAR_ARM: Cap[] = [
  [-9, -94, -6, -78, 9],
  [-6, -78, 5, -98, 8],
];
const GUARD: Cap[] = [
  [11, -94, 20, -83, 9.5],
  [20, -83, 23, -101, 8.5],
];
const JAB: Cap[] = [
  [11, -94, 28, -97, 9.5],
  [28, -97, 44, -100, 8.5],
];
const TORSO = "M-10 -64 C-12 -76 -15 -86 -13 -97 L13 -97 C15 -86 12 -76 10 -64 Z";
const SHORTS = "M-13 -67 L13 -67 L16 -46 L6 -44 L2 -52 L-2 -44 L-15 -46 Z";

function Body({ color, grow, shorts }: { color: string; grow: number; shorts: string }) {
  const caps = (list: Cap[]) => list.map(([x1, y1, x2, y2, w], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={w + grow} />);
  return (
    <g stroke={color} fill={color} strokeLinecap="round" strokeLinejoin="round">
      {caps(LEGS)}
      <ellipse cx="-20" cy="-2" rx="8" ry="3" />
      <ellipse cx="23" cy="-2" rx="8" ry="3" />
      {caps(REAR_ARM)}
      <circle cx="6" cy="-100" r={6.5 + grow / 2} />
      <path d={TORSO} strokeWidth={grow || 1} />
      <rect x="-3" y="-105" width="8" height="9" strokeWidth={grow || 1} />
      <ellipse cx="4" cy="-111" rx={7.5 + grow / 2} ry={9 + grow / 2} />
      <path d={SHORTS} fill={shorts} stroke={shorts} strokeWidth={grow || 1} />
      <g className={styles.guard}>
        {caps(GUARD)}
        <circle cx="24" cy="-104" r={7 + grow / 2} />
      </g>
      <g className={styles.jab}>
        {caps(JAB)}
        <circle cx="47" cy="-100" r={7 + grow / 2} />
      </g>
    </g>
  );
}

function Fighter({ x, flip, rim, shorts, delay }: { x: number; flip?: boolean; rim: string; shorts: string; delay: string }) {
  // Silhouette with a coloured rim light and corner-coloured shorts. Faces right unless flipped.
  return (
    <g transform={`translate(${x} ${CY + 16}) scale(${flip ? -1.15 : 1.15} 1.15)`} style={{ "--d": delay } as CSSProperties} className={styles.fighter}>
      <ellipse cx="0" cy="2" rx="34" ry="6" fill="#000" opacity="0.4" />
      <g transform="translate(-2 0)" opacity="0.9">
        <Body color={rim} grow={3} shorts={rim} />
      </g>
      <Body color="#0a0c11" grow={0} shorts={shorts} />
    </g>
  );
}

export function ArenaScene({ className, align = "center" }: { className?: string; align?: "center" | "bottom" }) {
  return (
    <div className={[styles.scene, className].filter(Boolean).join(" ")} aria-hidden>
      <svg viewBox="0 0 1600 1000" preserveAspectRatio={align === "bottom" ? "xMidYMax slice" : "xMidYMid slice"} focusable="false">
        <defs>
          <linearGradient id="as-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#030407" />
            <stop offset="0.55" stopColor="#0b0f17" />
            <stop offset="1" stopColor="#05070a" />
          </linearGradient>
          <radialGradient id="as-spill" cx="0.5" cy="0.62" r="0.5">
            <stop offset="0" stopColor="#cfd8ea" stopOpacity="0.32" />
            <stop offset="0.45" stopColor="#7d8fb3" stopOpacity="0.1" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="as-canvas" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor="#f2f4f7" />
            <stop offset="0.6" stopColor="#b9c0cc" />
            <stop offset="1" stopColor="#5d6573" />
          </radialGradient>
          <linearGradient id="as-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="as-vignette" cx="0.5" cy="0.55" r="0.75">
            <stop offset="0.55" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.85" />
          </radialGradient>
          <pattern id="as-crowd" width="16" height="13" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="3" fill="#1c2333" />
            <circle cx="12" cy="10" r="3" fill="#161c29" />
          </pattern>
          <pattern id="as-mesh" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0 H9 M0 0 V9" stroke="#c9d2e3" strokeWidth="0.8" />
          </pattern>
          <filter id="as-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id="as-soft">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        <rect width="1600" height="1000" fill="url(#as-sky)" />

        {/* Lighting rig */}
        <g className={styles.rig}>
          <rect x="420" y="70" width="760" height="10" rx="3" fill="#121722" />
          {[480, 620, 800, 980, 1120].map((x) => (
            <circle key={x} cx={x} cy="88" r="7" fill="#fff6dc" />
          ))}
        </g>

        {/* Stands: a bowl of tiny heads, lit near the cage */}
        <ellipse cx={CX} cy={CY - 10} rx="980" ry="430" fill="url(#as-crowd)" />
        <ellipse cx={CX} cy={CY - 10} rx="980" ry="430" fill="url(#as-spill)" />
        <ellipse cx={CX} cy={CY + 10} rx="560" ry="215" fill="#07090d" />

        <g className={styles.flashes}>
          {FLASHES.map((f, i) => (
            <circle key={i} cx={f.x.toFixed(1)} cy={f.y.toFixed(1)} r="2.4" fill="#fff" style={{ animationDelay: `${f.d}s` }} />
          ))}
        </g>

        {/* Spotlight beams */}
        <g className={styles.beams} filter="url(#as-blur)">
          <polygon className={styles.beam} points={`480,88 494,88 ${CX - 120},${CY + 60} ${CX - 330},${CY + 60}`} fill="url(#as-beam)" />
          <polygon
            className={`${styles.beam} ${styles.beamSlow}`}
            points={`793,88 807,88 ${CX + 170},${CY + 70} ${CX - 170},${CY + 70}`}
            fill="url(#as-beam)"
          />
          <polygon className={styles.beam} points={`1106,88 1120,88 ${CX + 330},${CY + 60} ${CX + 120},${CY + 60}`} fill="url(#as-beam)" />
        </g>

        {/* Octagon: canvas, back fence, fighters, front fence */}
        <polygon points={pts(OCT)} fill="url(#as-canvas)" />
        <polygon points={pts(OCT)} fill="none" stroke="#2a313d" strokeWidth="6" />
        <ellipse cx={CX} cy={CY} rx="70" ry="26" fill="none" stroke="#8a93a3" strokeOpacity="0.5" strokeWidth="2" />
        <circle cx={OCT[7][0] + 10} cy={OCT[7][1] + 6} r="9" fill="#d42a37" />
        <circle cx={OCT[3][0] - 10} cy={OCT[3][1] - 6} r="9" fill="#2459e0" />

        {FACES.filter((f) => f.back).map((f, i) => (
          <polygon key={`b${i}`} points={f.d} fill="url(#as-mesh)" opacity="0.35" />
        ))}

        <g className={styles.fighters}>
          <g className={styles.left}>
            <Fighter x={CX - 46} rim="#ff5a66" shorts="#b51f2a" delay="0s" />
          </g>
          <g className={styles.right}>
            <Fighter x={CX + 46} flip rim="#6e98ff" shorts="#1f45b8" delay="1.7s" />
          </g>
        </g>
        <ellipse cx={CX} cy={CY + 20} rx="90" ry="10" fill="#000" opacity="0.35" filter="url(#as-soft)" />

        {FACES.filter((f) => !f.back).map((f, i) => (
          <polygon key={`f${i}`} points={f.d} fill="url(#as-mesh)" opacity="0.5" />
        ))}
        {OCT.map(([x, y], i) => (
          <line key={i} x1={x} y1={y} x2={x} y2={y - FENCE} stroke="#0a0d12" strokeWidth="5" />
        ))}
        <polyline
          points={pts([...OCT.map(([x, y]) => [x, y - FENCE] as const), [OCT[0][0], OCT[0][1] - FENCE]])}
          fill="none"
          stroke="#141923"
          strokeWidth="6"
        />

        {/* Haze */}
        <g className={styles.haze} filter="url(#as-blur)">
          <ellipse cx="560" cy="520" rx="260" ry="60" fill="#c8d2e6" opacity="0.07" />
          <ellipse cx="1060" cy="470" rx="300" ry="70" fill="#c8d2e6" opacity="0.06" />
        </g>

        {/* Spectators in the foreground */}
        <g fill="#05070b" className={styles.crowd}>
          {SECOND_ROW.map((p, i) => (
            <Person key={`s${i}`} {...p} />
          ))}
        </g>
        <g className={styles.phones}>
          {PHONES.map((p, i) => (
            <rect key={i} x={p.x + 20} y={p.y - 96} width="22" height="36" rx="4" fill="#dfe8ff" style={{ animationDelay: `${i * 1.3}s` }} />
          ))}
        </g>
        <g fill="#020305">
          {FRONT_ROW.map((p, i) => (
            <Person key={`f${i}`} {...p} />
          ))}
        </g>

        <rect width="1600" height="1000" fill="url(#as-vignette)" />
      </svg>
    </div>
  );
}
