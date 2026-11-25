// Brand mark: a calendar page with an AI spark. Also used as the favicon (app/icon.svg).
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="tenxcalender logo">
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="0.55" stopColor="#9333ea" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
        <linearGradient id="lg-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#lg-bg)" />
      <rect x="12" y="16" width="40" height="36" rx="8" fill="#fff" />
      <path d="M12 24a8 8 0 0 1 8-8h24a8 8 0 0 1 8 8v3H12z" fill="#fff" fillOpacity=".0" />
      <rect x="21" y="10" width="5" height="12" rx="2.5" fill="#fff" />
      <rect x="38" y="10" width="5" height="12" rx="2.5" fill="#fff" />
      <rect x="12" y="26" width="40" height="3" fill="#e0e7ff" />
      <rect x="18" y="33" width="6" height="5" rx="1.5" fill="#c7d2fe" />
      <rect x="18" y="42" width="6" height="5" rx="1.5" fill="#c7d2fe" />
      <rect x="40" y="42" width="6" height="5" rx="1.5" fill="#c7d2fe" />
      <path d="M33 31 L35.6 37.4 L42 40 L35.6 42.6 L33 49 L30.4 42.6 L24 40 L30.4 37.4 Z" fill="url(#lg-spark)" />
    </svg>
  );
}
