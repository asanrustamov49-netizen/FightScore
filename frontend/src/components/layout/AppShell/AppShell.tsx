"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { usePreferences, useResolvedTheme } from "@/src/lib/preferences";
import { useSession } from "@/src/lib/session";
import type { Me } from "@/src/lib/types";
import styles from "./AppShell.module.scss";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Shown only when the user has this permission (UI hint; the server checks every request). */
  permission?: string;
  capability?: keyof Me["capabilities"];
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Соревнования",
    items: [
      { href: "/dashboard", label: "Обзор", icon: "dashboard" },
      { href: "/tournaments", label: "Турниры", icon: "trophy" },
      { href: "/matches", label: "Поединки", icon: "versus" },
      { href: "/athletes", label: "Спортсмены", icon: "users", capability: "organizer" },
      { href: "/displays", label: "Табло", icon: "display", capability: "displays" },
    ],
  },
  { group: "Регламенты", items: [{ href: "/rules", label: "Профили правил", icon: "book" }] },
  {
    group: "Система",
    items: [
      { href: "/admin/users", label: "Пользователи", icon: "shield", permission: "user.manage" },
      { href: "/settings", label: "Настройки", icon: "settings" },
    ],
  },
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

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

function ThemeToggle() {
  const { save } = usePreferences();
  const current = useResolvedTheme();
  const next = current === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={() => save({ theme: next })}
      aria-label={next === "light" ? "Включить светлую тему" : "Включить тёмную тему"}
      title={next === "light" ? "Светлая тема" : "Тёмная тема"}
    >
      <Icon name={current === "dark" ? "sun" : "moon"} size={20} />
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, error, can, logout, refresh } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (loading) return <Loading label="Загрузка профиля…" />;
  if (error || !me) return <ErrorState message={error ?? "Нет данных профиля"} onRetry={refresh} />;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const roleNames = [...new Set(me.roles.map((r) => r.name))].join(", ") || "Без роли";
  const visible = (n: NavItem) => (!n.permission || can(n.permission)) && (!n.capability || me.capabilities[n.capability]);

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        К содержимому
      </a>
      <aside className={`${styles.sidebar} ${menuOpen ? styles.open : ""}`} aria-label="Боковое меню">
        <div className={styles.sidebarTop}>
          <Brand />
          <button type="button" className={`${styles.iconButton} ${styles.closeButton}`} onClick={() => setMenuOpen(false)} aria-label="Закрыть меню">
            <Icon name="close" size={20} />
          </button>
        </div>
        <nav className={styles.nav} aria-label="Основная навигация">
          {NAV.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={g.group} className={styles.group}>
                <span className={styles.navLabel}>{g.group}</span>
                {items.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`${styles.link} ${isActive(n.href) ? styles.active : ""}`}
                    aria-current={isActive(n.href) ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon name={n.icon} size={19} />
                    {n.label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className={styles.account}>
          <Link href="/settings" className={styles.accountLink} onClick={() => setMenuOpen(false)} title="Настройки аккаунта">
            <span className={styles.avatar} aria-hidden>
              {initials(me.user.displayName)}
            </span>
            <span className={styles.accountText}>
              <span className={styles.userName}>{me.user.displayName}</span>
              <span className={styles.userRole}>{roleNames}</span>
            </span>
          </Link>
          <button type="button" className={styles.iconButton} onClick={logout} aria-label="Выйти" title="Выйти">
            <Icon name="logout" size={19} />
          </button>
        </div>
      </aside>
      {menuOpen && <button type="button" className={styles.scrim} aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
      <div className={styles.content}>
        {me.deployMode === "dev-http" && (
          <div className={styles.devBanner}>Тестовый режим без шифрования (HTTP). Не используйте его для реального турнира.</div>
        )}
        <header className={styles.header}>
          <button type="button" className={`${styles.iconButton} ${styles.menuButton}`} onClick={() => setMenuOpen(true)} aria-label="Открыть меню" aria-expanded={menuOpen}>
            <Icon name="menu" size={22} />
          </button>
          <span className={styles.headerBrand}>
            <Brand />
          </span>
          <div className={styles.headerActions}>
            <ThemeToggle />
            <Link href="/settings" className={styles.headerUser} title="Настройки">
              <span className={styles.avatar} aria-hidden>
                {initials(me.user.displayName)}
              </span>
              <span className={styles.headerUserName}>{me.user.displayName}</span>
            </Link>
          </div>
        </header>
        <main className={styles.main} id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className={styles.footer}>
          <span>FightScore · рабочее название</span>
          <span>Данные поединков подтверждаются сервером</span>
        </footer>
      </div>
    </div>
  );
}
