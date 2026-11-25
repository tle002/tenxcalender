// Time helpers. The server is assumed to run in the user's timezone (local
// laptop), so local Date methods are the user's wall-clock time.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalISO(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function dayName(d: Date): string {
  return DAYS[d.getDay()];
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function tzName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// "Thu 26 Nov, 2:00 PM"
export function describe(d: Date): string {
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dayName(d)} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${h12}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

// Accepts "2026-11-26" (local date) or a full ISO string. endOfDay makes a bare
// date inclusive by moving it to the start of the next day.
export function parseDateInput(s: string, endOfDay = false): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const x = new Date(y, m - 1, d);
    return endOfDay ? addDays(x, 1) : x;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${s}`);
  return new Date(t);
}
