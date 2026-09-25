import { useSyncExternalStore } from 'react';

export type ActivityLevel = 'info' | 'success' | 'warn' | 'error';

export interface ActivityEntry {
  id: number;
  at: Date;
  level: ActivityLevel;
  source: string;
  message: string;
  txHash?: `0x${string}`;
}

const MAX_ENTRIES = 50;
let entries: ActivityEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Append an entry to the observability log shown on the page (and to the console). */
export function logActivity(level: ActivityLevel, source: string, message: string, txHash?: `0x${string}`) {
  entries = [{ id: nextId++, at: new Date(), level, source, message, txHash }, ...entries].slice(0, MAX_ENTRIES);
  const line = `[${source}] ${message}${txHash ? ` (${txHash})` : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
  emit();
}

export function clearActivity() {
  entries = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActivity(): ActivityEntry[] {
  return useSyncExternalStore(subscribe, () => entries, () => entries);
}
