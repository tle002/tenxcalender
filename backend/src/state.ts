import { config } from "./config.js";
import { HistoryStore } from "./history.js";

// History of applied changes. Mock calendars reset on restart, so their history is
// memory-only; real-calendar history is persisted so Undo survives a restart.
let store: HistoryStore | null = null;
export const getHistory = (): HistoryStore => (store ??= new HistoryStore(!config.useMock));
export const resetHistory = () => getHistory().clear();
