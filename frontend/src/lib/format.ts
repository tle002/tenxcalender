const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export const fmtDay = (iso: string) => DAY.format(new Date(iso));
export const fmtTime = (iso: string) => TIME.format(new Date(iso));
export const fmtWhen = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;
export const fmtRange = (r: { start: string; end: string }) => `${fmtDay(r.start)} · ${fmtTime(r.start)} – ${fmtTime(r.end)}`;
export const minutes = (r: { start: string; end: string }) => Math.round((Date.parse(r.end) - Date.parse(r.start)) / 60000);
