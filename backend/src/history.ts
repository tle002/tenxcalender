import { readJson, writeJson } from "./data.js";
import { log } from "./logger.js";
import type { CalendarProvider, ChangeType, TimeRange } from "./types.js";

export interface HistoryItem {
  changeId: string;
  type: ChangeType;
  title: string;
  eventId?: string; // created event (create) or the existing event
  from?: TimeRange;
  to?: TimeRange;
}

export interface HistoryEntry {
  id: string;
  at: string; // ISO
  intent: string;
  source: "command" | "fix" | "focus";
  summary: string;
  items: HistoryItem[];
  undoneAt?: string;
  undoNotes?: string[];
}

// The mock calendar resets on restart, so its history is memory-only. Real calendar
// history is kept in backend/data/history.json so Undo still works after a restart.
export class HistoryStore {
  private entries: HistoryEntry[];
  constructor(private readonly persist: boolean) {
    this.entries = persist ? readJson<HistoryEntry[]>("history.json", []) : [];
  }
  private save() {
    if (this.persist) writeJson("history.json", this.entries.slice(0, 100));
  }
  list(): HistoryEntry[] {
    return this.entries;
  }
  get(id: string) {
    return this.entries.find((e) => e.id === id);
  }
  add(e: Omit<HistoryEntry, "id" | "at">): HistoryEntry {
    const entry: HistoryEntry = { id: `h_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), ...e };
    this.entries.unshift(entry);
    this.entries = this.entries.slice(0, 100);
    this.save();
    return entry;
  }
  clear() {
    this.entries = [];
    this.save();
  }
  markUndone(id: string, notes: string[]) {
    const e = this.get(id);
    if (e) {
      e.undoneAt = new Date().toISOString();
      e.undoNotes = notes;
      this.save();
    }
  }
}

// Reverse an applied entry, newest change first. Anything edited since is left alone.
export async function undoEntry(provider: CalendarProvider, entry: HistoryEntry): Promise<{ notes: string[]; failed: number }> {
  const notes: string[] = [];
  let failed = 0;
  for (const it of [...entry.items].reverse()) {
    try {
      if (it.type === "create" && it.eventId) {
        if (await provider.getEvent(it.eventId)) {
          await provider.remove(it.eventId);
          notes.push(`Removed "${it.title}"`);
        } else notes.push(`"${it.title}" was already gone`);
      } else if ((it.type === "move" || it.type === "shorten") && it.eventId && it.from && it.to) {
        const ev = await provider.getEvent(it.eventId);
        if (!ev) notes.push(`"${it.title}" no longer exists, left alone`);
        else if (Date.parse(ev.start) !== Date.parse(it.to.start) || Date.parse(ev.end) !== Date.parse(it.to.end)) {
          notes.push(`"${it.title}" was changed again since, left alone`);
          failed++;
        } else {
          await provider.move(it.eventId, it.from.start, it.from.end);
          notes.push(`Restored "${it.title}" to its original time`);
        }
      } else if (it.type === "decline" && it.eventId) {
        await provider.restore(it.eventId);
        notes.push(`Restored "${it.title}"`);
      }
    } catch (err) {
      failed++;
      notes.push(`Could not undo "${it.title}": ${(err as Error).message}`);
      log.warn("undo item failed", { entry: entry.id, item: it, message: (err as Error).message });
    }
  }
  return { notes, failed };
}
