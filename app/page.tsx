import Link from "next/link";
import { cookies } from "next/headers";
import { FaUser } from "react-icons/fa";
import { AgriDispatchLogo } from "./components/agri-dispatch-logo";
import { PipelineRoad } from "./components/pipeline-road";
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

export default async function Home() {
  const cookieStore = await cookies();
  const session = cookieStore.get("auth_token")?.value
    ? verifyAuthToken(cookieStore.get("auth_token")!.value)
    : null;
  return (
    <div className="min-h-full bg-zinc-950 text-white">
      <header className="border-b border-white/10 bg-zinc-950/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link href="/" className="group inline-flex items-center gap-3">
            <AgriDispatchLogo className="h-10 w-10 shadow-lg shadow-emerald-500/20" />
            <span>
              <span className="block text-sm font-semibold tracking-wide">
                AgriDispatch
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
        <section className="relative overflow-hidden border-b border-white/10">
          {/* Background video */}
          <video
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
            src="https://videos.pexels.com/video-files/10396646/10396646-hd_1920_1080_30fps.mp4"
          />
          {/* Overlay: dark green left → dark right, matching brand palette */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#052e16]/85 via-[#052e16]/60 to-zinc-950/80" />
          <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-36">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-300">
              Farm to market control room
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
              One place to run the harvest, pricing, route, and dispatch flow.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-200 sm:text-lg">
              Login or create an account to access the tools available for your role.
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
        </section>

        <section className="border-t border-white/10 bg-zinc-950">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:py-20">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
              Supply chain pipeline
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
              From harvest to dispatch
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Five stages. Click any stage you have access to.
            </p>
            <div className="mt-12 overflow-x-auto">
              <PipelineRoad role={session?.role ?? null} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
