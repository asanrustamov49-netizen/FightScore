"use client";

import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Local interface preferences of this browser (theme, background, density, motion).
 * Stored in localStorage: they are per device and never sent to the server. The inline script in
 * app/layout.tsx applies them before the first paint, so there is no theme flash and no hydration mismatch.
 */
export const PREFERENCE_OPTIONS = {
  theme: ["dark", "light", "system"],
  bg: ["corners", "plain", "ring", "mat", "octagon"],
  density: ["comfortable", "compact"],
  motion: ["system", "reduce", "full"],
} as const;

export type ThemePref = (typeof PREFERENCE_OPTIONS.theme)[number];
export type BackgroundPref = (typeof PREFERENCE_OPTIONS.bg)[number];
export type DensityPref = (typeof PREFERENCE_OPTIONS.density)[number];
export type MotionPref = (typeof PREFERENCE_OPTIONS.motion)[number];

export interface Preferences {
  theme: ThemePref;
  bg: BackgroundPref;
  density: DensityPref;
  motion: MotionPref;
}

export const DEFAULT_PREFERENCES: Preferences = { theme: "dark", bg: "corners", density: "comfortable", motion: "system" };

const KEY: Record<keyof Preferences, string> = { theme: "fs-theme", bg: "fs-bg", density: "fs-density", motion: "fs-motion" };

/** Same logic as the inline script below, kept as a string so it runs before React loads. */
export const PREFERENCES_SCRIPT = `(function(){try{var d=document.documentElement,s=window.localStorage,o=${JSON.stringify(
  PREFERENCE_OPTIONS,
)},f=${JSON.stringify(DEFAULT_PREFERENCES)},k=${JSON.stringify(KEY)};function g(n){var v=s.getItem(k[n]);return o[n].indexOf(v)>=0?v:f[n]}var t=g("theme");d.setAttribute("data-theme",t==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):t);d.setAttribute("data-bg",g("bg"));d.setAttribute("data-density",g("density"));d.setAttribute("data-motion",g("motion"))}catch(e){}})()`;

function read(): Preferences {
  const out = { ...DEFAULT_PREFERENCES };
  try {
    for (const name of Object.keys(KEY) as (keyof Preferences)[]) {
      const v = window.localStorage.getItem(KEY[name]);
      if (v && (PREFERENCE_OPTIONS[name] as readonly string[]).includes(v)) (out as Record<string, string>)[name] = v;
    }
  } catch {
    // Storage unavailable (private mode, blocked): defaults stay.
  }
  return out;
}

export function resolvedTheme(theme: ThemePref): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Writes the attributes the CSS reads. Used for live preview too, without saving. */
export function applyPreferences(p: Preferences) {
  const d = document.documentElement;
  d.setAttribute("data-theme", resolvedTheme(p.theme));
  d.setAttribute("data-bg", p.bg);
  d.setAttribute("data-density", p.density);
  d.setAttribute("data-motion", p.motion);
}

const listeners = new Set<() => void>();
let snapshot: Preferences | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onSystem = () => {
    const p = getSnapshot();
    if (p.theme === "system") applyPreferences(p);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key && Object.values(KEY).includes(e.key)) {
      snapshot = read();
      applyPreferences(snapshot);
      listeners.forEach((l) => l());
    }
  };
  media.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): Preferences {
  if (!snapshot) snapshot = read();
  return snapshot;
}

const getServerSnapshot = () => DEFAULT_PREFERENCES;

export function savePreferences(next: Preferences) {
  try {
    for (const name of Object.keys(KEY) as (keyof Preferences)[]) window.localStorage.setItem(KEY[name], next[name]);
  } catch {
    // Applied for this page view even if it cannot be stored.
  }
  snapshot = next;
  applyPreferences(next);
  listeners.forEach((l) => l());
}

/** The theme actually shown ("system" resolved). Read from <html>, where the inline script put it. */
export function useResolvedTheme(): "dark" | "light" {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"),
    () => "dark",
  );
}

export function usePreferences() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const save = useCallback((patch: Partial<Preferences>) => savePreferences({ ...getSnapshot(), ...patch }), []);
  return { prefs, save };
}

/**
 * Re-applies saved preferences after React's development remount clears attributes on <html>
 * (no-op in production, where the inline script already set them) and follows the OS theme.
 */
export function PreferencesSync() {
  useLayoutEffect(() => applyPreferences(getSnapshot()), []);
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return null;
}
