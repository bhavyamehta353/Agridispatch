import Link from "next/link";
import { cookies } from "next/headers";
import { FaUser } from "react-icons/fa";
import { LogoutButton } from "./components/logout-button";
import { verifyAuthToken, type UserRole } from "./lib/auth";

const roleModules: Record<
  UserRole,
  {
    title: string;
    description: string;
    href: string;
    cta: string;
  }[]
> = {
  admin: [
    {
      title: "Batch overview",
      description:
        "Track quality scoring, evaluation status, recommendations, and dispatch progress.",
      href: "/batches",
      cta: "Open dashboard",
    },
    {
      title: "Farmer intake",
      description:
        "Submit harvest batches with origin, maturity, weight, and handling details.",
      href: "/farmer",
      cta: "Open intake",
    },
    {
      title: "Pricing panel",
      description:
        "Maintain daily market prices and inspect append-only pricing history.",
      href: "/pricing",
      cta: "Manage prices",
    },
    {
      title: "Route conditions",
      description:
        "Monitor congestion, environmental decay risk, and route exposure.",
      href: "/traffic",
      cta: "Check routes",
    },
  ],
  farmers: [
    {
      title: "Batch overview",
      description:
        "Review submitted batches, evaluation status, and dispatch progress.",
      href: "/batches",
      cta: "Open dashboard",
    },
    {
      title: "Farmer intake",
      description:
        "Submit harvest batches with origin, maturity, weight, and handling details.",
      href: "/farmer",
      cta: "Open intake",
    },
    {
      title: "Pricing panel",
      description: "View and maintain market prices used by evaluations.",
      href: "/pricing",
      cta: "Open pricing",
    },
  ],
  logistics: [
    {
      title: "Batch overview",
      description:
        "Review batches, status, recommendations, and dispatch readiness.",
      href: "/batches",
      cta: "Open dashboard",
    },
    {
      title: "Pricing panel",
      description: "View market prices that influence dispatch economics.",
      href: "/pricing",
      cta: "Open pricing",
    },
    {
      title: "Route conditions",
      description:
        "Monitor congestion, environmental decay risk, and route exposure.",
      href: "/traffic",
      cta: "Check routes",
    },
  ],
};

const processSteps = [
  "Harvest intake",
  "Quality evaluation",
  "Market recommendation",
  "Route risk review",
  "Dispatch decision",
];

export default async function Home() {
  const cookieStore = await cookies();
  const session = cookieStore.get("auth_token")?.value
    ? verifyAuthToken(cookieStore.get("auth_token")!.value)
    : null;
  const allowedModules = session ? roleModules[session.role] : [];

  return (
    <div className="min-h-full bg-zinc-950 text-white">
      <header className="border-b border-white/10 bg-zinc-950/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link href="/" className="group inline-flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-sm font-black text-zinc-950 shadow-lg shadow-emerald-500/20">
              DT
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-wide">
                Digital Twin
              </span>
              <span className="block text-xs text-zinc-400 group-hover:text-zinc-300">
                Fresh produce operations
              </span>
            </span>
          </Link>
          <nav className="flex flex-wrap gap-2 text-sm">
            {session ? (
              <>
                <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-zinc-300">
                  <FaUser className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                  {session.name}
                </span>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-2 font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
                >
                  Login
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-emerald-500 px-3 py-2 font-bold text-zinc-950 hover:bg-emerald-400"
                >
                  Signup
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,#166534_0,#052e16_32%,#18181b_68%)]">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-16">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-300">
                Farm to market control room
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
                One place to run the harvest, pricing, route, and dispatch flow.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-200 sm:text-lg">
                Login or create an account to access the tools available for
                your role.
              </p>
              {!session ? (
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/login"
                    className="rounded-lg bg-emerald-500 px-5 py-3 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
                  >
                    Login
                  </Link>
                  <Link
                    href="/signup"
                    className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/15"
                  >
                    Create account
                  </Link>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/15 bg-zinc-950/70 p-4 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="grid gap-3 sm:grid-cols-2">
                {processSteps.map((step, index) => (
                  <div
                    key={step}
                    className={`rounded-xl border border-white/10 bg-white/[0.06] p-4 ${
                      index === processSteps.length - 1 ? "sm:col-span-2" : ""
                    }`}
                  >
                    <p className="font-mono text-xs text-emerald-300">
                      0{index + 1}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {step}
                    </p>
                  </div>
                ))}
              </div>
              {session ? (
                <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                  <p className="text-sm font-semibold text-emerald-100">
                    Your workspace
                  </p>
                  <p className="mt-1 text-xs leading-5 text-emerald-50/80">
                    You are signed in as {session.role}. Use the links below to
                    open your allowed pages.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {session ? (
          <section className="bg-zinc-100 text-zinc-950">
            <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
              <div className="grid gap-4 md:grid-cols-2">
                {allowedModules.map((module) => (
                  <Link
                    key={module.href}
                    href={module.href}
                    className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                  >
                    <h2 className="text-xl font-black tracking-tight text-zinc-950">
                      {module.title}
                    </h2>
                    <p className="mt-3 min-h-12 text-sm leading-6 text-zinc-600">
                      {module.description}
                    </p>
                    <p className="mt-5 text-sm font-bold text-emerald-700 group-hover:text-emerald-800">
                      {module.cta}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
