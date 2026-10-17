"use client";

import { useEffect, useState } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { useInstallOffer } from "@/src/lib/pwa";
import styles from "./InstallPrompt.module.scss";

const DISMISS_KEY = "fs:install-dismissed";

type Platform = "standalone" | "ios" | "other";

function detect(): Platform {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return "standalone";
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "other";
}

/**
 * Unobtrusive install offer: a button when the browser supports installation (Chromium), a short
 * instruction on iOS Safari, nothing otherwise or after the user dismissed it.
 */
export function InstallPrompt() {
  const offer = useInstallOffer();
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let wasDismissed = false;
    try {
      wasDismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // storage unavailable: just show the offer
    }
    const id = requestAnimationFrame(() => {
      setPlatform(detect());
      setDismissed(wasDismissed);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  if (dismissed || !platform || platform === "standalone" || offer.installed) return null;
  if (platform === "other" && !offer.available) return null;

  return (
    <aside className={styles.banner} aria-label="Установка приложения">
      <span className={styles.icon}>
        <Icon name="download" />
      </span>
      <div className={styles.text}>
        <strong>Установите FightScore как приложение</strong>
        {platform === "ios"
          ? "В Safari нажмите «Поделиться», затем «На экран „Домой“». Приложение откроется в отдельном окне; для работы по-прежнему нужен сервер."
          : "Отдельное окно без вкладок и значок на рабочем столе. Для работы по-прежнему нужна связь с сервером соревнований."}
      </div>
      <div className={styles.actions}>
        {platform !== "ios" && (
          <Button variant="primary" size="sm" onClick={() => void offer.install()}>
            Установить
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Скрыть предложение установки">
          <Icon name="close" size={18} />
        </Button>
      </div>
    </aside>
  );
}
