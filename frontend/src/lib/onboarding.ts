"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Onboarding tips ("what is this section for") that a user can hide.
 *
 * What the welcome screen and the preparation checklist show is derived from server data (no tournaments
 * yet, what a tournament still lacks), so it is the same on every device and disappears by itself once the
 * work is done. Only the choice "hide this tip" is local to the browser: it is a display convenience, not
 * state that has to follow the user. No database field is needed for it (docs/ARCHITECTURE.md §16).
 */
const KEY = "fs-tips-hidden";

const listeners = new Set<() => void>();
let snapshot: string[] | null = null;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(next: string[]) {
  snapshot = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the tip stays hidden for this page view only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    snapshot = read();
    listeners.forEach((x) => x());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => (snapshot ??= read());
// On the server and during hydration every tip counts as hidden: no flash of a tip the user closed.
const SERVER: string[] = ["*"];
const getServerSnapshot = () => SERVER;

/** Show the tips again (account menu → "Показать подсказки снова"). */
export function resetTips() {
  write([]);
}

export function useTip(id: string) {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dismiss = useCallback(() => {
    const cur = getSnapshot();
    if (!cur.includes(id)) write([...cur, id]);
  }, [id]);
  return { visible: !hidden.includes(id) && !hidden.includes("*"), dismiss };
}
