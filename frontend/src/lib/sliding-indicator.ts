"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * Moves one highlight under the active item of a menu instead of repainting each item: the container gets the active
 * item's box as CSS variables (--ind-x, --ind-y, --ind-w, --ind-h) and `data-ind` ("on"/"off"); the indicator element
 * animates transform and size only (GPU-friendly). The first placement is not animated (`data-ind-ready` is set after it),
 * so the highlight never flies in from the corner on page load. Re-measured on resize and when `key` changes.
 */
export function useSlidingIndicator(container: RefObject<HTMLElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const box = container.current;
    if (!box) return;
    const place = () => {
      const active = box.querySelector<HTMLElement>('[aria-current="page"], [data-ind-active="true"]');
      if (!active || active.offsetParent === null) {
        box.dataset.ind = "off";
        return;
      }
      const b = box.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      box.style.setProperty("--ind-x", `${a.left - b.left + box.scrollLeft}px`);
      box.style.setProperty("--ind-y", `${a.top - b.top + box.scrollTop}px`);
      box.style.setProperty("--ind-w", `${a.width}px`);
      box.style.setProperty("--ind-h", `${a.height}px`);
      box.dataset.ind = "on";
    };
    place();
    // A timer, not requestAnimationFrame: it also fires in a background tab, so the first move is never instant.
    const ready = setTimeout(() => (box.dataset.indReady = "true"), 60);
    const ro = new ResizeObserver(place);
    ro.observe(box);
    return () => {
      clearTimeout(ready);
      ro.disconnect();
    };
  }, [container, key]);
}
