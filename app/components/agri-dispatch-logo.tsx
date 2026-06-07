export function AgriDispatchLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className ?? "h-10 w-10"}
      aria-label="AgriDispatch logo"
    >
      <rect width="48" height="48" rx="11" fill="#10b981" />
      {/* Leaf accent top-right */}
      <path d="M30 10 C30 10 38 12 38 20 C34 20 30 16 30 10Z" fill="#065f46" />
      {/* A letterform */}
      <path
        d="M17 33 L22 16 L27 16 L32 33"
        stroke="#052e16"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <line x1="19.5" y1="26" x2="29.5" y2="26" stroke="#052e16" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
