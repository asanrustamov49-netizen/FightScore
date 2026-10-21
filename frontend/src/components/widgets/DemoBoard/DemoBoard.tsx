"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/src/components/ui/Icon/Icon";
import styles from "./DemoBoard.module.scss";

type Side = "red" | "blue";

/** Fixed script of illustrative actions: the same on every visit, no random data. */
const SCRIPT: { side: Side; points: number }[] = [
  { side: "red", points: 2 },
  { side: "blue", points: 1 },
  { side: "red", points: 1 },
  { side: "blue", points: 2 },
  { side: "blue", points: 1 },
  { side: "red", points: 3 },
];

const ROUND = 180;

function reducedMotion() {
  const pref = document.documentElement.getAttribute("data-motion");
  if (pref === "reduce") return true;
  if (pref === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * An animated illustration of the TV display and judge panel for public pages. It is a picture of the product,
 * not a real match: labelled "Пример", driven by a fixed script, and stopped when motion is reduced or the tab is hidden.
 */
export function DemoBoard({ compact = false }: { compact?: boolean }) {
  const [time, setTime] = useState(161);
  const [score, setScore] = useState<Record<Side, number>>({ red: 5, blue: 3 });
  const [last, setLast] = useState<{ side: Side; points: number; n: number } | null>(null);

  useEffect(() => {
    if (reducedMotion()) return;
    let tick = 0;
    let step = 0;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      tick += 1;
      setTime((t) => (t <= 1 ? ROUND : t - 1));
      if (tick % 4 === 0) {
        const e = SCRIPT[step % SCRIPT.length];
        setScore((sc) => (sc.red + sc.blue > 24 ? { red: 0, blue: 0 } : { ...sc, [e.side]: sc[e.side] + e.points }));
        setLast({ ...e, n: step });
        step += 1;
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const hit = (side: Side) => (last?.side === side ? `${side}${last.n}` : side);

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ""}`} aria-hidden>
      <div className={styles.board}>
        <div className={styles.top}>
          <span className={styles.label}>Пример табло</span>
          <span className={styles.period}>Период 2 из 3</span>
          <span className={styles.live}>
            <i />
            Идёт
          </span>
        </div>
        <div className={styles.body}>
          <div className={`${styles.corner} ${styles.red} ${last?.side === "red" ? styles.hit : ""}`} key={hit("red")}>
            <span className={styles.name}>Красный угол</span>
            <span className={styles.score}>{score.red}</span>
          </div>
          <div className={styles.clock}>
            <span>{clock(time)}</span>
            <small>осталось</small>
            <div className={styles.bar}>
              <span style={{ transform: `scaleX(${time / ROUND})` }} />
            </div>
          </div>
          <div className={`${styles.corner} ${styles.blue} ${last?.side === "blue" ? styles.hit : ""}`} key={hit("blue")}>
            <span className={styles.name}>Синий угол</span>
            <span className={styles.score}>{score.blue}</span>
          </div>
        </div>
      </div>

      {!compact && (
        <div className={`${styles.float} ${styles.pad}`}>
          <span className={styles.floatTitle}>
            <Icon name="judge" size={15} />
            Судейская панель
          </span>
          <div className={styles.keys}>
            {(["red", "red", "blue", "blue"] as Side[]).map((side, i) => {
              const pts = i % 2 ? 2 : 1;
              const pressed = last?.side === side && last.points === pts;
              return (
                <span key={i} className={`${side === "red" ? styles.keyRed : styles.keyBlue} ${pressed ? styles.pressed : ""}`}>
                  +{pts}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className={`${styles.float} ${styles.log}`} key={last?.n ?? "start"}>
        <span className={styles.logIcon}>
          <Icon name="check" size={14} />
        </span>
        <span>
          <strong>Сервер подтвердил</strong>
          <small>{last ? `+${last.points} ${last.side === "red" ? "красному" : "синему"} углу · в журнале` : "Счёт и время синхронизированы"}</small>
        </span>
      </div>
    </div>
  );
}
