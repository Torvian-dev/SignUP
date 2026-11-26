/** Torv.io brand mark — a subtle royal-blue rounded square with a white "T" lettermark. */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Torv.io">
      <defs>
        <linearGradient id="torv-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a4fd0" />
          <stop offset="1" stopColor="#002a9e" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="118" fill="url(#torv-grad)" />
      {/* T: top bar + centred stem */}
      <path d="M140 150 H372 V206 H284 V412 H228 V206 H140 Z" fill="#ffffff" />
    </svg>
  );
}

/** Mark + wordmark, for the sidebar and auth screens. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoMark className="h-6 w-6" />
      <span className="text-lg font-semibold tracking-tight">
        Torv<span className="text-primary">.io</span>
      </span>
    </div>
  );
}
