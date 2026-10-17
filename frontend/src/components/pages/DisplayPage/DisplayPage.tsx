"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Flag } from "@/src/components/ui/Flag/Flag";
import { formatClock, STATUS_LABEL } from "@/src/lib/format";
import { useCountdown, useDisplayChannel } from "@/src/lib/realtime";
import type { PublicSide, Side } from "@/src/lib/types";
import styles from "./DisplayPage.module.scss";

/** Public TV scoreboard. Read-only: no navigation, no controls except a fullscreen toggle. */
export function DisplayPage() {
  const { token } = useParams<{ token: string }>();
  const { data, status, error, offset } = useDisplayChannel(token);
  const m = data?.match;
  const remaining = useCountdown(m?.clock, m?.serverTime, offset);
  const [isFullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const side = (s: Side, p: PublicSide) => (
    <section className={`${styles.side} ${styles[s]}`}>
      <div>
        <div className={styles.name}>{p.name ?? "—"}</div>
        <div className={styles.country}>
          <Flag code={p.countryCode} name={p.countryName} /> {p.countryName}
          {p.club ? ` · ${p.club}` : ""}
        </div>
      </div>
      <div className={styles.score}>{p.score}</div>
      <div className={styles.penalties}>
        {p.penalties.map((x) => (
          <span key={x.code} className={styles.penalty}>
            {x.label}
            {x.count > 1 ? ` ×${x.count}` : ""}
          </span>
        ))}
      </div>
    </section>
  );

  const lost = status !== "online" && !!data;

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.headLeft}>
          <span>{data?.display.tournamentName ?? "FightScore"}</span>
          {m && (
            <span className={styles.muted}>
              №{m.matchNumber} · {m.disciplineName}
            </span>
          )}
        </div>
        <div className={styles.headLeft}>
          {m?.isDemoRules && <span className={styles.demo}>Демо-правила</span>}
          {m && <span className={`${styles.status} ${m.status === "live" ? styles.statusLive : ""}`}>{STATUS_LABEL[m.status]}</span>}
        </div>
      </header>

      {m ? (
        <div className={styles.board}>
          {side("red", m.red)}
          <div className={styles.center}>
            <div className={styles.period}>{m.period ? `Период ${m.period}${m.periodsCount ? ` / ${m.periodsCount}` : ""}` : "Ожидание старта"}</div>
            <div className={`${styles.clock} ${m.clock.running ? "" : styles.clockStopped}`}>{formatClock(remaining)}</div>
          </div>
          {side("blue", m.blue)}
        </div>
      ) : (
        <div className={styles.idle}>
          {error ?? (data ? "Ожидание поединка" : "Подключение к табло…")}
          {data && !error && <span className={styles.idleSub}>{data.display.name}</span>}
        </div>
      )}

      <footer className={styles.foot}>
        <span>{data?.display.name}</span>
        <span>FightScore</span>
      </footer>

      {m?.result && (
        <div className={styles.result}>
          {m.result.winnerSide ? `Победа: ${m[m.result.winnerSide].name}` : "Без победителя"} · {m.result.outcome}
        </div>
      )}

      {lost && (
        <div className={styles.offline} role="alert">
          <div className={styles.offlineBox}>
            НЕТ СВЯЗИ С СЕРВЕРОМ
            <span className={styles.offlineSub}>Показаны последние полученные данные, они могут быть устаревшими</span>
          </div>
        </div>
      )}

      {!isFullscreen && (
        <button className={styles.fullscreen} onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>
          На весь экран
        </button>
      )}
    </div>
  );
}
