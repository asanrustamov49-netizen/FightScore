"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import styles from "./ModeSwitch.module.scss";

export type Mode = "organizer" | "judge" | "display";

const MODES: Record<Mode, { href: string; label: string; icon: IconName }> = {
  organizer: { href: "/dashboard", label: "Организатор", icon: "organizer" },
  judge: { href: "/judge", label: "Судья", icon: "judge" },
  display: { href: "/display", label: "Табло", icon: "display" },
};

function activeMode(pathname: string): Mode {
  if (pathname === "/judge" || pathname.startsWith("/judge/")) return "judge";
  if (pathname === "/display" || pathname.startsWith("/display/")) return "display";
  return "organizer";
}

/**
 * The three places a person can work in: the organizer's panel, the judge's panel and the TV display. Always in the
 * same spot and order, so anyone can see where they are and where to go next. A navigation hint only: each page
 * still checks access on the server.
 */
export function ModeSwitch({ modes = ["organizer", "judge", "display"], className }: { modes?: Mode[]; className?: string }) {
  const current = activeMode(usePathname());
  return (
    <nav className={`${styles.switch} ${className ?? ""}`} aria-label="Режим работы">
      {modes.map((m) => {
        const x = MODES[m];
        const active = m === current;
        return (
          <Link key={m} href={x.href} className={`${styles.item} ${styles[m]} ${active ? styles.active : ""}`} aria-current={active ? "page" : undefined}>
            <Icon name={x.icon} size={18} />
            <span>{x.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
