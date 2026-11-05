// The docs agent's face: a friendly, neutral robot on a purple tile, drawn flat with no outlines so it
// still reads at 16px as two eyes. Rendered as plain SVG elements so the same drawing also becomes
// PNG icons (the Chrome extension, notifications).

type Mood = "idle" | "thinking" | "happy" | "sleeping";

const C = {
  tile: "#7f56d9",
  face: "#f4f1ff",
  ink: "#1f1640",
  cheek: "#d9cdfd",
  antenna: "#ffffff",
};

function Eyes({ mood }: { mood: Mood }) {
  if (mood === "happy" || mood === "sleeping") {
    // Happy: upturned arcs. Asleep: closed, downturned arcs.
    const d = mood === "happy" ? "M31 56 Q37 47 43 56 M57 56 Q63 47 69 56" : "M31 52 Q37 59 43 52 M57 52 Q63 59 69 52";
    return <path d={d} fill="none" stroke={C.ink} strokeWidth={4.6} strokeLinecap="round" />;
  }
  return (
    <>
      {[32, 58].map((x) => (
        <g key={x} className="mascot-eye">
          <rect x={x} y={44} width={10} height={15} rx={5} fill={C.ink} />
          <circle cx={x + 3.2} cy={48} r={1.9} fill="#fff" />
        </g>
      ))}
    </>
  );
}

/** The docs agent on its tile, at any size. `animate` adds a blink (idle), an upward glance (thinking), or a slow breath (sleeping). */
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
        <rect width={100} height={100} fill={C.tile} />
        {/* Antenna */}
        <rect x={48} y={10} width={4} height={14} rx={2} fill={C.antenna} opacity={0.85} />
        <circle cx={50} cy={10} r={5} fill={C.antenna} />
        {/* Head */}
        <rect x={16} y={24} width={68} height={58} rx={20} fill={C.face} />
        {/* Called, not rendered as a component, so the SVG holds only plain elements (the PNG renderer requires it). */}
        {Eyes({ mood })}
        {/* Cheeks and mouth */}
        <ellipse cx={27} cy={66} rx={5} ry={3.2} fill={C.cheek} />
        <ellipse cx={73} cy={66} rx={5} ry={3.2} fill={C.cheek} />
        <path
          d={mood === "thinking" ? "M44 70 H56" : mood === "happy" ? "M41 66 Q50 76 59 66" : "M43 68 Q50 73 57 68"}
          fill="none"
          stroke={C.ink}
          strokeWidth={3.4}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** The docs agent where it speaks: the composer, threads, and Home. Animated by default. */
export function MascotAvatar({ size = 24, mood = "idle", animate = true }: { size?: number; mood?: Mood; animate?: boolean }) {
  return <Mascot size={size} mood={mood} animate={animate} />;
}
