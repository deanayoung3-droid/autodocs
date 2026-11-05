// Docs Agent's face: a golden retriever-doodle, drawn as a flat close-up portrait that fills its tile.
// No outlines; the face is cropped by the tile's edges, so it reads at 16px as two eyes and a nose.

type Mood = "idle" | "thinking" | "happy" | "sleeping";

const C = {
  fur: "#f3c98c",
  mop: "#e2a95e",
  ear: "#d69a4f",
  curl: "#c4863d",
  muzzle: "#fbe3bd",
  ink: "#2a1a14",
  line: "#8a5a2b",
  tongue: "#ee8a86",
};

// A curly edge: a run of overlapping circles.
const curls = (pts: [number, number, number][], fill: string) =>
  pts.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} fill={fill} />);

function Eyes({ mood }: { mood: Mood }) {
  if (mood === "happy" || mood === "sleeping") {
    // Happy: upturned arcs. Asleep: closed, downturned arcs.
    const d = mood === "happy" ? "M30 58 Q36 49 42 58 M58 58 Q64 49 70 58" : "M30 54 Q36 61 42 54 M58 54 Q64 61 70 54";
    return <path d={d} fill="none" stroke={C.ink} strokeWidth={4.4} strokeLinecap="round" />;
  }
  return (
    <>
      {[31, 59].map((x) => (
        <g key={x} className="mascot-eye">
          <rect x={x} y={46} width={10} height={16} rx={5} fill={C.ink} />
          <circle cx={x + 3.2} cy={50} r={1.9} fill="#fff" />
        </g>
      ))}
    </>
  );
}

/** Docs Agent on its tile, at any size. `animate` adds a blink (idle), an upward glance (thinking), or a slow breath (sleeping). */
export function Mascot({
  size = 24,
  mood = "idle",
  animate = false,
  label,
  className = "",
}: {
  size?: number;
  mood?: Mood;
  animate?: boolean;
  label?: string;
  className?: string;
}) {
  const motion = animate ? (mood === "thinking" ? "mascot-think" : mood === "sleeping" ? "mascot-breathe" : mood === "idle" ? "mascot-blink" : "") : "";
  return (
    <span
      className={`inline-block shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.24)) }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        className={`block ${motion}`}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        <rect width={100} height={100} fill={C.fur} />
        {/* Floppy ears at the edges, curly on the inside */}
        <ellipse cx={-3} cy={64} rx={17} ry={36} fill={C.ear} />
        {curls([[12, 40, 7.5], [14, 55, 8], [13, 70, 8], [9, 85, 8]], C.ear)}
        <ellipse cx={103} cy={64} rx={17} ry={36} fill={C.ear} />
        {curls([[88, 40, 7.5], [86, 55, 8], [87, 70, 8], [91, 85, 8]], C.ear)}
        {/* The mop of curls over the forehead */}
        {curls(
          [
            [6, 6, 17],
            [28, 0, 17],
            [50, 2, 18],
            [72, 0, 17],
            [94, 6, 17],
            [20, 21, 10],
            [37, 25, 10.5],
            [54, 24, 11],
            [71, 22, 10],
            [85, 17, 9],
          ],
          C.mop,
        )}
        <path d="M22 13 q4 -4 8 0 M44 14 q4 -4 8 0 M64 11 q4 -4 8 0 M33 23 q3 -3 6 0 M58 22 q3 -3 6 0" fill="none" stroke={C.curl} strokeWidth={2.6} strokeLinecap="round" />
        {/* Brow tufts */}
        <path d="M29 40 Q35 36 42 39 M58 39 Q65 36 71 40" fill="none" stroke={C.curl} strokeWidth={3.2} strokeLinecap="round" />
        {/* Called, not rendered as a component, so the SVG holds only plain elements (the PNG renderer requires it). */}
        {Eyes({ mood })}
        {/* Muzzle, nose, mouth */}
        <ellipse cx={50} cy={90} rx={27} ry={21} fill={C.muzzle} />
        <path d="M41 72 Q41 67.5 45.5 67.5 H54.5 Q59 67.5 59 72 Q59 76 53.5 79.5 Q50 81.5 46.5 79.5 Q41 76 41 72 Z" fill={C.ink} />
        <ellipse cx={46.5} cy={70.5} rx={2.6} ry={1.4} fill="#fff" opacity={0.35} />
        {mood === "happy" && <path d="M45 86 H55 V90 Q55 95 50 95 Q45 95 45 90 Z" fill={C.tongue} />}
        <path
          d={mood === "thinking" ? "M50 81 V84.5 M45 87 H55" : "M50 81 V85 M43 85.5 Q46.5 89.5 50 85.5 Q53.5 89.5 57 85.5"}
          fill="none"
          stroke={C.line}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Docs Agent where it speaks: the composer, threads, and Home. Animated by default. */
export function MascotAvatar({ size = 24, mood = "idle", animate = true }: { size?: number; mood?: Mood; animate?: boolean }) {
  return <Mascot size={size} mood={mood} animate={animate} />;
}
