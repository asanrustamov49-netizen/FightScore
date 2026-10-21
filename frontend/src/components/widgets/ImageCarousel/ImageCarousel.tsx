"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import styles from "./ImageCarousel.module.scss";

export interface Slide {
  src: string;
  caption: string;
  /** CSS object-position: keeps the subject in frame when the image is cropped. */
  focus?: string;
}

/** Fight-night photos for the public pages. Files live in /public/auth (local, no network). */
export const FIGHT_SLIDES: Slide[] = [
  { src: "/auth/arena-lights.webp", caption: "Арена под светом", focus: "50% 45%" },
  { src: "/auth/red-vs-blue.webp", caption: "Красный угол против синего", focus: "55% 35%" },
  { src: "/auth/corner-prep.webp", caption: "Перед выходом", focus: "40% 35%" },
  { src: "/auth/octagon-ref.webp", caption: "Рефери в клетке", focus: "50% 50%" },
  { src: "/auth/cage-action.webp", caption: "Борьба в партере", focus: "55% 40%" },
  { src: "/auth/boxing-exchange.webp", caption: "Обмен ударами", focus: "45% 30%" },
];

function reducedMotion() {
  const pref = document.documentElement.getAttribute("data-motion");
  if (pref === "reduce") return true;
  if (pref === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Full-bleed photo carousel: slow crossfade with a camera push-in on the active slide. Decorative: the images are
 * hidden from screen readers, the indicators are real buttons.
 *
 * Timing has one source: the CSS animation of the active progress bar. When it ends, the next slide starts, so the
 * bar and the change always match and there is never more than one timer. Hover and a hidden tab pause that
 * animation; reduced motion keeps the first loaded slide and does not advance.
 */
export function ImageCarousel({
  slides = FIGHT_SLIDES,
  interval = 5200,
  captions = true,
  indicators = true,
  sizes = "(min-width: 768px) 50vw, 100vw",
}: {
  slides?: Slide[];
  interval?: number;
  captions?: boolean;
  indicators?: boolean;
  /** Rendered width of the carousel, for picking the image size. */
  sizes?: string;
}) {
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Slides that failed to load are skipped; the next one is shown only once it has loaded (no black flash).
  // onLoad can fire before hydration (cached or fast image): the ref also checks an already finished load.
  const markLoaded = useCallback((src: string) => setLoaded((l) => (l.has(src) ? l : new Set(l).add(src))), []);
  const markFailed = useCallback((src: string) => setFailed((f) => new Set(f).add(src)), []);
  const usable = slides.filter((s) => !failed.has(s.src));
  const next = () => {
    // Reduced motion: the bar ends at once (global CSS), so the check is made here, at the moment of advancing.
    if (reducedMotion() || usable.length < 2) return;
    const cur = usable.findIndex((s) => s.src === slides[active]?.src);
    const cand = usable[(cur + 1) % usable.length];
    // Not loaded yet: stay; the bar is re-keyed by loaded.size and runs again once it arrives.
    if (loaded.has(cand.src)) setActive(slides.indexOf(cand));
  };
  const paused = hover || hidden;
  const cur = slides[active];

  return (
    <div
      className={`${styles.carousel} ${paused ? styles.paused : ""}`}
      style={{ "--interval": `${interval}ms` } as React.CSSProperties}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className={styles.frames} aria-hidden>
        {slides.map((s, i) =>
          failed.has(s.src) ? null : (
            <div key={s.src} className={`${styles.frame} ${i === active && loaded.has(s.src) ? styles.active : ""}`}>
              <Photo slide={s} sizes={sizes} priority={i === 0} onLoaded={markLoaded} onFailed={markFailed} />
            </div>
          ),
        )}
      </div>
      <div className={styles.light} aria-hidden />
      <div className={styles.vignette} aria-hidden />
      <div className={`${styles.controls} ${indicators ? "" : styles.controlsHidden}`} aria-hidden={!indicators}>
        {captions && cur && (
          <span className={styles.caption} key={active} aria-hidden>
            {cur.caption}
          </span>
        )}
        <div className={styles.dots} role="group" aria-label="Слайды">
          {slides.map((s, i) =>
            failed.has(s.src) ? null : (
              <button
                key={s.src}
                type="button"
                tabIndex={indicators ? 0 : -1}
                className={`${styles.dot} ${i === active ? styles.dotActive : ""}`}
                aria-label={`Слайд ${i + 1}: ${s.caption}`}
                aria-current={i === active}
                onClick={() => loaded.has(s.src) && setActive(i)}
              >
                {/* Re-keyed per slide: the bar restarts from zero, its end advances the carousel. */}
                <span key={i === active ? `on${active}-${loaded.size}` : "off"} onAnimationEnd={i === active ? next : undefined} />
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/** One photo. The ref catches an image that finished loading before hydration (onLoad would never fire for it). */
function Photo({
  slide,
  sizes,
  priority,
  onLoaded,
  onFailed,
}: {
  slide: Slide;
  sizes: string;
  priority: boolean;
  onLoaded: (src: string) => void;
  onFailed: (src: string) => void;
}) {
  const { src } = slide;
  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth > 0) onLoaded(src);
    },
    [src, onLoaded],
  );
  return (
    <Image
      ref={ref}
      src={src}
      alt=""
      fill
      sizes={sizes}
      priority={priority}
      style={{ objectPosition: slide.focus ?? "50% 50%" }}
      onLoad={() => onLoaded(src)}
      onError={() => onFailed(src)}
    />
  );
}
