"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { ModeSwitch, type Mode } from "@/src/components/ui/ModeSwitch/ModeSwitch";
import { ErrorState, PageSkeleton } from "@/src/components/ui/Notice/Notice";
import { resetTips } from "@/src/lib/onboarding";
import { usePreferences, useResolvedTheme } from "@/src/lib/preferences";
import { useSlidingIndicator } from "@/src/lib/sliding-indicator";
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
  /** Active only on this exact path (a section home whose sub-pages have their own item). */
  exact?: boolean;
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
    group: "Администрирование",
    items: [
      { href: "/admin", label: "Обзор платформы", icon: "shield", capability: "platformAdmin", exact: true },
      { href: "/admin/users", label: "Пользователи", icon: "users", capability: "platformAdmin" },
    ],
  },
  { group: "Система", items: [{ href: "/settings", label: "Настройки", icon: "settings" }] },
];

/**
 * Phone tab bar: the four places used most, always one thumb away; everything else stays in the side menu ("Ещё").
 * Items the user cannot use are skipped and the next one takes the slot.
 */
const TABS: NavItem[] = [
  { href: "/dashboard", label: "Обзор", icon: "dashboard" },
  { href: "/tournaments", label: "Турниры", icon: "trophy" },
  { href: "/matches", label: "Поединки", icon: "versus" },
  { href: "/displays", label: "Табло", icon: "display", capability: "displays" },
  { href: "/judge", label: "Судья", icon: "judge", capability: "judge" },
  { href: "/admin", label: "Админ", icon: "shield", capability: "platformAdmin", exact: true },
];

/** Logo mark: the red and blue corners split by the centre line. Inline SVG, no network. */
export function BrandMark({ size = 28 }: { size?: number }) {
  // Unique gradient ids: two marks on one page must not point at a hidden one.
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const r = `fs-mark-r${uid}`;
  const b = `fs-mark-b${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false" className={styles.mark}>
      <defs>
        <linearGradient id={r} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5a66" />
          <stop offset="1" stopColor="#c9202d" />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#1f4fd6" />
        </linearGradient>
      </defs>
      <path d="M9 2h14l7 7v14l-7 7H9l-7-7V9z" fill={`url(#${b})`} />
      <path d="M9 2h9.5L13.5 30H9l-7-7V9z" fill={`url(#${r})`} />
      <path d="M18.5 2 13.5 30" stroke="#fff" strokeOpacity=".9" strokeWidth="1.6" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className={styles.brand}>
      <BrandMark />
      <span>
        Fight<span className={styles.brandAccent}>Score</span>
      </span>
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

/** Account menu in the header: settings, tips, sign-out. Closes on Esc, outside click and navigation. */
function UserMenu({ me, roleNames, onLogout }: { me: Me; roleNames: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.userMenu} ref={ref}>
      <button
        type="button"
        className={styles.headerUser}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Меню аккаунта: ${me.user.displayName}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.avatar} aria-hidden>
          {initials(me.user.displayName)}
        </span>
        <span className={styles.headerUserName}>{me.user.displayName}</span>
        <Icon name="chevron" size={16} className={styles.headerChevron} />
      </button>
      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropdownHead}>
            <strong>{me.user.displayName}</strong>
            <span>{me.user.login}</span>
            <span>{roleNames}</span>
          </div>
          <Link href="/settings" className={styles.dropdownItem}>
            <Icon name="settings" size={18} />
            Настройки
          </Link>
          {me.capabilities.organizer && (
            <Link href="/dashboard" className={styles.dropdownItem} onClick={() => resetTips()}>
              <Icon name="help" size={18} />
              Показать подсказки снова
            </Link>
          )}
          <button type="button" className={styles.dropdownItem} onClick={onLogout}>
            <Icon name="logout" size={18} />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, error, can, logout, refresh } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  // One highlight slides to the active item (side menu and phone tab bar); re-placed after the profile loads.
  useSlidingIndicator(navRef, `${pathname}|${loading}`);
  useSlidingIndicator(tabsRef, `${pathname}|${loading}`);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Same frame as the loaded shell, so nothing jumps when the profile arrives.
  if (loading)
    return (
      <div className={styles.shell} aria-busy="true">
        <aside className={`${styles.sidebar} ${styles.sidebarSkeleton}`} aria-hidden>
          <span className="fs-skeleton" style={{ width: "8.5rem", height: 28 }} />
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="fs-skeleton" style={{ height: 38, opacity: 1 - i * 0.08 }} />
          ))}
        </aside>
        <div className={styles.content}>
          <header className={styles.header} aria-hidden>
            <span className="fs-skeleton" style={{ width: "2.2rem", height: 32, marginLeft: "auto", borderRadius: "50%" }} />
          </header>
          <main className={styles.main}>
            <PageSkeleton cards={4} label="Загрузка профиля…" />
          </main>
        </div>
      </div>
    );
  if (error || !me) return <ErrorState message={error ?? "Нет данных профиля"} onRetry={refresh} />;

  const isActive = (n: NavItem) => pathname === n.href || (!n.exact && pathname.startsWith(`${n.href}/`));
  const roleNames = [...new Set(me.roles.map((r) => r.name))].join(", ") || "Без роли";
  // Judge panel and public display are open to everyone (the pages sign in and check access); the organizer's panel
  // is shown to organizers only.
  const modes: Mode[] = me.capabilities.organizer ? ["organizer", "judge", "display"] : ["judge", "display"];
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
        <nav ref={navRef} className={styles.nav} aria-label="Основная навигация">
          <span className={styles.navIndicator} aria-hidden />
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
                    className={`${styles.link} ${isActive(n) ? styles.active : ""}`}
                    aria-current={isActive(n) ? "page" : undefined}
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
      <button
        type="button"
        className={`${styles.scrim} ${menuOpen ? styles.scrimOpen : ""}`}
        aria-label="Закрыть меню"
        tabIndex={menuOpen ? 0 : -1}
        aria-hidden={!menuOpen}
        onClick={() => setMenuOpen(false)}
      />
      <div className={styles.content}>
        {me.deployMode === "dev-http" && (
          <div className={styles.devBanner}>Тестовый режим без шифрования (HTTP). Не используйте его для реального турнира.</div>
        )}
        <header className={styles.header}>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.menuButton}`}
            onClick={() => setMenuOpen(true)}
            aria-label="Открыть меню"
            aria-expanded={menuOpen}
          >
            <Icon name="menu" size={22} />
          </button>
          <span className={styles.headerBrand}>
            <Brand />
          </span>
          <ModeSwitch modes={modes} className={styles.modeSwitch} />
          <div className={styles.headerActions}>
            <ThemeToggle />
            <UserMenu me={me} roleNames={roleNames} onLogout={logout} />
          </div>
        </header>
        <main className={styles.main} id="main" tabIndex={-1}>
          {/* Keyed by path: each page fades in; switching tabs inside a page (?tab=) keeps it. */}
          <div key={pathname} className={styles.pageIn}>
            {children}
          </div>
        </main>
        <nav ref={tabsRef} className={styles.tabbar} aria-label="Быстрая навигация">
          <span className={styles.tabIndicator} aria-hidden />
          {TABS.filter(visible)
            .slice(0, 4)
            .map((n) => (
              <Link key={n.href} href={n.href} className={`${styles.tab} ${isActive(n) ? styles.tabActive : ""}`} aria-current={isActive(n) ? "page" : undefined}>
                <Icon name={n.icon} size={22} />
                <span>{n.label}</span>
              </Link>
            ))}
          <button type="button" className={`${styles.tab} ${menuOpen ? styles.tabActive : ""}`} onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-label="Открыть всё меню">
            <Icon name="menu" size={22} />
            <span>Ещё</span>
          </button>
        </nav>
        <footer className={styles.footer}>
          <span>FightScore · рабочее название</span>
          <span className={styles.footerNote}>
            <Icon name="shield" size={14} />
            Счёт и время подтверждает сервер
          </span>
        </footer>
      </div>
    </div>
  );
}
