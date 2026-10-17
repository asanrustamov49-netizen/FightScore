"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { useSession } from "@/src/lib/session";
import styles from "./AppShell.module.scss";

const NAV: { href: string; label: string; permission?: string; capability?: "organizer" | "judge" | "displays" }[] = [
  { href: "/dashboard", label: "Обзор" },
  { href: "/tournaments", label: "Турниры" },
  { href: "/matches", label: "Поединки" },
  { href: "/athletes", label: "Спортсмены", capability: "organizer" },
  { href: "/displays", label: "Табло", capability: "displays" },
  { href: "/rules", label: "Правила" },
  { href: "/admin/users", label: "Пользователи", permission: "user.manage" },
];

export function Brand() {
  return (
    <Link href="/" className={styles.brand}>
      <span className={styles.mark} aria-hidden>
        <span />
        <span />
      </span>
      FightScore
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, error, can, logout, refresh } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return <Loading label="Загрузка профиля…" />;
  if (error || !me) return <ErrorState message={error ?? "Нет данных профиля"} onRetry={refresh} />;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const roleNames = [...new Set(me.roles.map((r) => r.name))].join(", ") || "Без роли";

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${menuOpen ? styles.open : ""}`}>
        <Brand />
        <nav className={styles.nav} aria-label="Основная навигация">
          <span className={styles.navLabel}>Соревнования</span>
          {NAV.filter((n) => (!n.permission || can(n.permission)) && (!n.capability || me.capabilities[n.capability])).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`${styles.link} ${isActive(n.href) ? styles.active : ""}`}
              aria-current={isActive(n.href) ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      {menuOpen && <button className={styles.scrim} aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
      <div>
        {me.deployMode === "dev-http" && (
          <div className={styles.devBanner}>Тестовый режим без шифрования (HTTP). Не используйте его для реального турнира.</div>
        )}
        <header className={styles.header}>
          <Button variant="ghost" size="sm" className={styles.menuButton} onClick={() => setMenuOpen(true)} aria-label="Открыть меню">
            ☰ Меню
          </Button>
          <div className={styles.user}>
            <div>
              <div className={styles.userName}>{me.user.displayName}</div>
              <div className={styles.userRole}>{roleNames}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={logout}>
              Выйти
            </Button>
          </div>
        </header>
      </div>
      <main className={styles.main} id="main">
        {children}
      </main>
      <footer className={styles.footer}>
        <span>FightScore · рабочее название</span>
        <span>Данные поединков подтверждаются сервером</span>
      </footer>
    </div>
  );
}
