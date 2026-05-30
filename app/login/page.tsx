"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const json = (await res.json()) as { error?: string };

      if (!res.ok) {
        setStatus("error");
        setMessage(json.error ?? "Login failed.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-10 text-zinc-950">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <section className="order-2 lg:order-1">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
                  Login
                </p>
                <h1 className="mt-2 text-2xl font-black tracking-tight">
                  Welcome back
                </h1>
              </div>
              <Link
                href="/signup"
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                Signup
              </Link>
            </div>

            <form onSubmit={onSubmit} className="mt-6 space-y-5">
              <label className="block text-sm font-medium text-zinc-700">
                Name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-zinc-300 px-3 py-3 text-zinc-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="Enter your name"
                />
              </label>

              <label className="block text-sm font-medium text-zinc-700">
                Password
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-zinc-300 px-3 py-3 text-zinc-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="Enter password"
                />
              </label>

              {message ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                  {message}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {status === "loading" ? "Logging in..." : "Login"}
              </button>
            </form>
          </div>
        </section>

        <section className="order-1 lg:order-2">
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-sm font-black text-zinc-950">
              DT
            </span>
            <span className="font-semibold">Digital Twin</span>
          </Link>
          <h2 className="mt-8 text-4xl font-black tracking-tight sm:text-5xl">
            Continue to your role workspace.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-600">
            Admin users go to batch operations, farmers go to harvest intake,
            and logistics users go to route conditions.
          </p>
        </section>
      </div>
    </main>
  );
}
