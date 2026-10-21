"use client";

import { useEffect } from "react";

/**
 * Scroll reveal for elements marked with `data-reveal`: they rise into place when they enter the viewport.
 *
 * Content is never hidden in the server HTML: the hiding rule in globals.scss applies only after this hook marks
 * <html data-reveal-ready>, so without JavaScript (or before hydration) everything stays visible. One observer per
 * page, each element is revealed once and then unobserved, so scrolling costs nothing afterwards.
 * Stagger inside a group: set `--i` on the element. Reduced motion collapses the transition (globals.scss).
 */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const root = document.documentElement;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])"));
    if (!("IntersectionObserver" in window) || !targets.length) return;

    // Elements already on screen at load are shown at once, without waiting for the observer.
    const vh = window.innerHeight;
    for (const el of targets) if (el.getBoundingClientRect().top < vh * 0.92) el.setAttribute("data-revealed", "");
    root.setAttribute("data-reveal-ready", "");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-revealed", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    for (const el of targets) if (!el.hasAttribute("data-revealed")) io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
