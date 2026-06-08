"use client";

import Link from "next/link";
import { useState } from "react";
import { AgriDispatchLogo } from "../components/agri-dispatch-logo";

export default function LoginPage() {
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

      window.location.href = "/";
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-zinc-950 flex flex-col items-center justify-center gap-8 px-4 py-12"
      style={{
        background: "linear-gradient(135deg, #052e16 0%, #09090b 55%)",
      }}
    >
      {/* Radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 15% 18%, rgba(16,185,129,0.13) 0%, transparent 70%)",
        }}
      />

      {/* Logo */}
      <Link href="/" className="relative z-10 flex items-center gap-3 group">
        <AgriDispatchLogo className="h-10 w-10 shadow-lg shadow-emerald-500/20" />
        <div>
          <div className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors">
            AgriDispatch
          </div>
          <div className="text-xs text-zinc-500">Fresh produce operations</div>
        </div>
      </Link>

      {/* Glass card */}
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/[0.12] bg-white/[0.055] p-8 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
          Login
        </p>
        <h1 className="mt-1.5 text-xl font-black tracking-tight text-white">
          Welcome back
        </h1>

        <form onSubmit={onSubmit} className="mt-7 space-y-4">
          <label className="block text-xs font-semibold text-zinc-400">
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
            />
          </label>

          <label className="block text-xs font-semibold text-zinc-400">
            Password
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
            />
          </label>

          {message ? (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={status === "loading"}
            className="mt-2 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {status === "loading" ? "Logging in..." : "Login"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-600">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
