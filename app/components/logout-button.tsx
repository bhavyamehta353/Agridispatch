"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FaSignOutAlt } from "react-icons/fa";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 font-semibold text-zinc-200 hover:bg-white/15 hover:text-white disabled:opacity-60"
    >
      <FaSignOutAlt className="h-3.5 w-3.5" aria-hidden />
      {loading ? "Logging out..." : "Logout"}
    </button>
  );
}
