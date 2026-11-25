// Brand mark: a calendar page with an AI spark, flat Google-style colours. Also the favicon (app/icon.svg).
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="tenxcalender logo">
      <g>
<rect width="64" height="64" rx="16" fill="#4285f4"/>
<rect x="12" y="16" width="40" height="36" rx="8" fill="#fff"/>
<rect x="21" y="9" width="5" height="12" rx="2.5" fill="#ea4335"/>
<rect x="38" y="9" width="5" height="12" rx="2.5" fill="#34a853"/>
<rect x="12" y="26" width="40" height="3" fill="#e8eaed"/>
<rect x="18" y="33" width="6" height="5" rx="1.5" fill="#fbbc04"/>
<rect x="18" y="42" width="6" height="5" rx="1.5" fill="#34a853"/>
<rect x="40" y="42" width="6" height="5" rx="1.5" fill="#ea4335"/>
<path d="M33 31 35.6 37.4 42 40 35.6 42.6 33 49 30.4 42.6 24 40 30.4 37.4Z" fill="#4285f4"/>
</g>
    </svg>
  );
}
