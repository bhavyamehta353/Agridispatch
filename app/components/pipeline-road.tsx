import Link from "next/link";
import type { UserRole } from "../lib/auth";

const stages = [
  {
    id: "01",
    icon: "🌱",
    title: "Harvest Intake",
    description:
      "Log each batch as it comes off the farm, capturing origin coordinates, AGMARK maturity grade, packed weight, and harvest time. This creates the record that every downstream stage depends on.",
    href: "/farmer",
    cta: "Open intake",
  },
  {
    id: "02",
    icon: "🔬",
    title: "Quality Evaluation",
    description:
      "Run the handling assessment to score damage levels, compute the quality-packed index, and flag any batch that falls below the minimum dispatch threshold before it travels anywhere.",
    href: "/batches",
    cta: "View batches",
  },
  {
    id: "03",
    icon: "💰",
    title: "Market Pricing",
    description:
      "Pull live APMC modal prices from Agmarknet for each nearby mandi. Prices update daily and feed directly into the net-profit calculation used to rank dispatch options.",
    href: "/pricing",
    cta: "Manage prices",
  },
  {
    id: "04",
    icon: "🗺️",
    title: "Route Risk",
    description:
      "Fetch real-time road congestion and weather conditions along every origin-to-market route. The decay model uses temperature, humidity, and travel time to predict the quality that arrives at each market.",
    href: "/traffic",
    cta: "Check routes",
  },
  {
    id: "05",
    icon: "🚚",
    title: "Dispatch Decision",
    description:
      "See every batch ranked by net profit, arrival quality, and feasibility confidence. Confirm which consignments ship today and to which market, with a full audit trail behind each recommendation.",
    href: "/batches",
    cta: "Open dashboard",
  },
];

const accessibleHrefs: Record<UserRole, string[]> = {
  admin: ["/farmer", "/batches", "/pricing", "/traffic"],
  farmers: ["/farmer", "/batches", "/pricing"],
  logistics: ["/batches", "/pricing", "/traffic"],
};

// Layout constants (all in SVG/px units, container is 1000px wide)
const CARD_W = 390;
const CARD_H = 290;
const SPACING = 320; // vertical distance between stage centres
const CONTAINER_W = 1000;
const CONTAINER_H = CARD_H + SPACING * 4; // 1570px

const L = CARD_W;               // x where left card's right edge meets road (390)
const R = CONTAINER_W - CARD_W; // x where right card's left edge meets road (610)

// Stage centre y-values
const CY = Array.from({ length: 5 }, (_, i) => CARD_H / 2 + i * SPACING);
// [110, 360, 610, 860, 1110]

// Card top values = centre y − half card height
const CARD_TOPS = CY.map((cy) => cy - CARD_H / 2);
// [0, 250, 500, 750, 1000]

// SVG road path: smooth S-curves between waypoints
const CP = 90; // bezier control-point offset
const roadPath = [
  `M ${L},${CY[0]}`,
  `C ${L + CP},${CY[0]} ${R},${CY[1] - CP} ${R},${CY[1]}`,
  `C ${R},${CY[1] + CP} ${L},${CY[2] - CP} ${L},${CY[2]}`,
  `C ${L},${CY[2] + CP} ${R},${CY[3] - CP} ${R},${CY[3]}`,
  `C ${R},${CY[3] + CP} ${L},${CY[4] - CP} ${L},${CY[4]}`,
].join(" ");

export function PipelineRoad({ role }: { role: UserRole | null }) {
  return (
    <div
      className="relative mx-auto"
      style={{ width: CONTAINER_W, height: CONTAINER_H, maxWidth: "100%" }}
    >
      {/* SVG road — decorative, sits behind cards */}
      <svg
        viewBox={`0 0 ${CONTAINER_W} ${CONTAINER_H}`}
        className="absolute inset-0 h-full w-full"
        fill="none"
        aria-hidden
      >
        {/* Road surface */}
        <path d={roadPath} stroke="#141f18" strokeWidth="56" strokeLinecap="round" />
        {/* Emerald glow fill */}
        <path d={roadPath} stroke="#10b981" strokeWidth="56" strokeLinecap="round" opacity="0.07" />
        {/* Outer edge line */}
        <path d={roadPath} stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
        {/* Centre dashes */}
        <path
          d={roadPath}
          stroke="#10b981"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="14 13"
          opacity="0.22"
        />
        {/* Stage waypoint dots */}
        {CY.map((cy, i) => {
          const cx = i % 2 === 0 ? L : R;
          const accessible = role
            ? accessibleHrefs[role].includes(stages[i].href)
            : false;
          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r="14"
                fill={accessible ? "#10b981" : "#1f2a22"}
                opacity={accessible ? 1 : 0.5}
              />
              <circle
                cx={cx}
                cy={cy}
                r="6"
                fill={accessible ? "#052e16" : "#09090b"}
              />
            </g>
          );
        })}
      </svg>

      {/* Stage cards */}
      {stages.map((stage, i) => {
        const accessible = role
          ? accessibleHrefs[role].includes(stage.href)
          : false;
        const isRight = i % 2 === 1;

        return (
          <Link
            key={stage.id}
            href={accessible ? stage.href : "/login"}
            className={[
              "group absolute flex flex-col rounded-2xl border p-5 transition-all duration-200",
              isRight ? "right-0" : "left-0",
              accessible
                ? "border-emerald-900/80 bg-gradient-to-br from-emerald-950/70 to-zinc-950 hover:-translate-y-1 hover:border-emerald-500 hover:shadow-2xl hover:shadow-emerald-900/30"
                : "border-white/[0.06] bg-zinc-900/20 opacity-40",
            ].join(" ")}
            style={{
              top: CARD_TOPS[i],
              width: CARD_W,
              height: CARD_H,
            }}
          >
            <span className="font-mono text-xs font-bold tracking-widest text-emerald-500">
              {stage.id}
            </span>
            <span className="mt-3 text-4xl leading-none">{stage.icon}</span>
            <h3 className="mt-3 text-lg font-black text-white">{stage.title}</h3>
            <p className="mt-3 flex-1 text-sm leading-6 text-zinc-400">
              {stage.description}
            </p>
            <p
              className={`mt-4 text-sm font-bold ${
                accessible
                  ? "text-emerald-400 group-hover:text-emerald-300"
                  : "text-zinc-600"
              }`}
            >
              {accessible ? stage.cta : "No access"} →
            </p>
          </Link>
        );
      })}
    </div>
  );
}
