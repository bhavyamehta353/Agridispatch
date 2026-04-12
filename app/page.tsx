import Link from "next/link";

export default function Home() {
  return (
    <div className="p-6">
      <p>Hello</p>
      <p className="mt-4">
        <Link
          href="/farmer"
          className="text-[#2E7D32] underline underline-offset-2 hover:text-[#4CAF50]"
        >
          Farmer harvest intake form
        </Link>
      </p>
      <p className="mt-2">
        <Link
          href="/batches"
          className="text-[#2E7D32] underline underline-offset-2 hover:text-[#4CAF50]"
        >
          Batch overview (dashboard)
        </Link>
      </p>
      <p className="mt-2">
        <Link
          href="/batches"
          className="text-[#2E7D32] underline underline-offset-2 hover:text-[#4CAF50]"
        >
          Batch dispatch recommendation
        </Link>
        <span className="mt-1 block text-sm text-zinc-600">
          Open any batch from the overview to see the decision screen (
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs text-zinc-800">
            /batches/[recordId]
          </code>
          ).
        </span>
      </p>
      <p className="mt-2">
        <Link
          href="/pricing"
          className="text-[#2E7D32] underline underline-offset-2 hover:text-[#4CAF50]"
        >
          Market pricing panel
        </Link>
      </p>
      <p className="mt-2">
        <Link
          href="/traffic"
          className="text-[#2E7D32] underline underline-offset-2 hover:text-[#4CAF50]"
        >
          Route conditions (traffic &amp; environment)
        </Link>
      </p>
    </div>
  );
}
