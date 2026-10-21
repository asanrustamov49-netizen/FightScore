"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { RolePaths } from "@/src/components/widgets/RolePaths/RolePaths";
import { ImageCarousel } from "@/src/components/widgets/ImageCarousel/ImageCarousel";
import { DemoBoard } from "@/src/components/widgets/DemoBoard/DemoBoard";
import { InstallPrompt } from "@/src/components/widgets/InstallPrompt/InstallPrompt";
import { api, currentUser } from "@/src/lib/api";
import { useReveal } from "@/src/lib/reveal";
import type { AuthOptions, Me } from "@/src/lib/types";
import styles from "./LandingPage.module.scss";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "trophy", title: "Турниры и участники", text: "Черновик, публикация, проведение и архив. Спортсмены, клубы и регистрационные номера в одном месте." },
  { icon: "book", title: "Версии правил", text: "Профиль правил публикуется версией и больше не меняется. Каждый поединок помнит, по какой версии он прошёл." },
  { icon: "judge", title: "Судейская панель", text: "Крупные кнопки очков, нарушений и таймера. Судья видит только назначенные ему поединки." },
  { icon: "display", title: "Табло для ТВ", text: "Публичная страница по ссылке: углы, счёт, время и статус обновляются сами, без перезагрузки." },
  { icon: "history", title: "Журнал действий", text: "Каждое подтверждённое действие записывается. Исправление добавляет запись, а не стирает историю." },
  { icon: "wifiOff", title: "Без интернета", text: "Сервер работает на компьютере организатора в локальной сети. Потеря связи сразу видна на экранах." },
];

const SECTIONS = [
  { id: "roles", label: "Куда перейти" },
  { id: "features", label: "Возможности" },
  { id: "how", label: "Как это работает" },
] as const;

const STEPS: { title: string; text: string }[] = [
  { title: "Создайте турнир", text: "Название, даты, место и дисциплины. Начните с черновика." },
  { title: "Добавьте участников", text: "Внесите спортсменов в базу и зарегистрируйте их в турнире." },
  { title: "Правила и судьи", text: "Выберите опубликованную версию правил и назначьте судей." },
  { title: "Проведите поединки", text: "Судья ведёт счёт и время, табло показывает их зрителям." },
  { title: "Подтвердите итог", text: "Главный судья подтверждает результат, он попадает в журнал." },
];

/** Public start page: what FightScore is, who it is for, and where to begin. Nothing here needs an account. */
export function LandingPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [registration, setRegistration] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);

  // Phone section menu: closes on Esc (focus back to the button), on an outside tap and after choosing a section.
  useEffect(() => {
    if (!menuOpen) return;
    menuPanel.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuPanel.current?.contains(t) && !menuButton.current?.contains(t)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [menuOpen]);
  useReveal();

  // Highlights the section in view in the header nav (one observer, no scroll handlers).
  useEffect(() => {
    const els = SECTIONS.map((x) => document.getElementById(x.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setSection(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    currentUser<Me>().then(setMe, () => setMe(null));
    api.get<AuthOptions>("/auth/options").then(
      (o) => setRegistration(o.registration),
      () => setRegistration(false),
    );
  }, []);

  const startHref = registration ? "/login?mode=register&next=/dashboard" : "/login?next=/dashboard";

  const primaryCta = me ? (
    <ButtonLink href="/dashboard" variant="primary" size="lg">
      Открыть панель
      <Icon name="arrow" size={18} />
    </ButtonLink>
  ) : (
    <>
      <ButtonLink href={startHref} variant="primary" size="lg">
        Начать работу
        <Icon name="arrow" size={18} />
      </ButtonLink>
      <ButtonLink href="/login?next=/dashboard" size="lg">
        Войти
      </ButtonLink>
    </>
  );

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Brand />
        <nav className={styles.topNav} aria-label="Разделы страницы">
          {SECTIONS.map((x) => (
            <a
              key={x.id}
              href={`#${x.id}`}
              className={section === x.id ? styles.navActive : undefined}
              aria-current={section === x.id ? "location" : undefined}
            >
              {x.label}
            </a>
          ))}
        </nav>
        <div className={styles.who}>
          <button
            ref={menuButton}
            type="button"
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls="landing-sections"
            aria-label={menuOpen ? "Закрыть меню разделов" : "Открыть меню разделов"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={20} />
          </button>
          {me ? (
            <>
              <span className={styles.whoName}>{me.user.displayName}</span>
              <ButtonLink href="/dashboard" size="sm" variant="primary">
                Панель
              </ButtonLink>
            </>
          ) : (
            me === null && (
              <>
                <ButtonLink href="/login?next=/dashboard" size="sm" variant="ghost">
                  Войти
                </ButtonLink>
                {registration && (
                  <ButtonLink href={startHref} size="sm" variant="primary" className={styles.topStart}>
                    Начать работу
                  </ButtonLink>
                )}
              </>
            )
          )}
        </div>
        {menuOpen && (
          <div ref={menuPanel} id="landing-sections" className={styles.mobileNav}>
            <nav aria-label="Разделы страницы">
              {SECTIONS.map((x) => (
                <a
                  key={x.id}
                  href={`#${x.id}`}
                  className={section === x.id ? styles.mobileNavActive : undefined}
                  aria-current={section === x.id ? "location" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {x.label}
                  <Icon name="chevron" size={18} />
                </a>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className={styles.main}>
        <section className={styles.hero} data-theme="dark">
          <div className={styles.heroBg}>
            <ImageCarousel captions={false} indicators={false} interval={6000} sizes="100vw" />
          </div>
          <div className={styles.heroText}>
            <span className={styles.chip} style={{ "--i": 0 } as CSSProperties}>
              <Icon name="bolt" size={15} />
              Судейство и табло для единоборств
            </span>
            <h1 className={styles.title} style={{ "--i": 1 } as CSSProperties}>
              {["Турнир", "под", "контролем"].map((w, i) => (
                <Fragment key={w}>
                  <span className={styles.word} style={{ "--w": i } as CSSProperties}>
                    {w}
                  </span>{" "}
                </Fragment>
              ))}
              <span className={`${styles.word} ${styles.gradientText}`} style={{ "--w": 3 } as CSSProperties}>
                от заявки до результата
              </span>
            </h1>
            <p className={styles.lead} style={{ "--i": 2 } as CSSProperties}>
              FightScore помогает организаторам соревнований по единоборствам вести турниры, участников и поединки. Судья управляет счётом с ноутбука, зрители
              видят табло на телевизоре, а сервер подтверждает и записывает каждое действие.
            </p>
            <div className={styles.ctas} style={{ "--i": 3 } as CSSProperties}>
              {primaryCta}
            </div>
            <a href="#roles" className={styles.quick} style={{ "--i": 4 } as CSSProperties}>
              <Icon name="judge" size={16} />
              Судья или табло? Выберите свой вход ниже
              <Icon name="chevron" size={16} />
            </a>
          </div>

          <div className={styles.visual}>
            <DemoBoard />
          </div>
        </section>

        <section id="roles" className={styles.section} aria-labelledby="roles-title">
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>Куда перейти</span>
            <h2 id="roles-title" className={styles.sectionTitle}>
              Выберите, кто вы сегодня
            </h2>
            <p className={styles.sectionLead}>Три входа, у каждого свой экран. Переключиться можно в любой момент: кнопки «Организатор · Судья · Табло» всегда наверху.</p>
          </div>
          <RolePaths
            paths={[
              {
                key: "organizer",
                title: "Организатор",
                who: "Готовит турнир, участников, поединки и судей.",
                steps: ["Создайте турнир", "Добавьте спортсменов и поединки", "Назначьте судей и табло"],
                cta: me?.capabilities.organizer ? "Открыть панель" : registration ? "Создать аккаунт" : "Войти",
                href: me?.capabilities.organizer ? "/dashboard" : startHref,
                icon: "organizer",
                photo: "/auth/arena-lights.webp",
                focus: "50% 45%",
              },
              {
                key: "judge",
                title: "Судья",
                who: "Ведёт счёт и время назначенного поединка с ноутбука.",
                steps: ["Войдите под учётной записью судьи", "Выберите свой поединок", "Ведите счёт крупными кнопками"],
                cta: "Мои поединки",
                href: "/judge",
                icon: "judge",
                photo: "/auth/octagon-ref.webp",
                focus: "62% 50%",
              },
              {
                key: "display",
                title: "Табло",
                who: "Показывает зрителям счёт и таймер на телевизоре.",
                steps: ["Получите ссылку у организатора", "Откройте её на ТВ или экране", "Табло обновляется само"],
                cta: "Открыть табло",
                href: "/display",
                icon: "display",
                photo: "/auth/red-vs-blue.webp",
                focus: "55% 35%",
              },
            ]}
          />
        </section>

        <section id="features" className={styles.section} aria-labelledby="features-title">
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>Возможности</span>
            <h2 id="features-title" className={styles.sectionTitle}>
              Всё, что нужно для проведения соревнований
            </h2>
            <p className={styles.sectionLead}>Без таблиц, ручного табло и споров о том, кто и когда изменил счёт.</p>
          </div>
          <div className={styles.features}>
            {FEATURES.map((f, i) => (
              <article key={f.title} className={styles.feature} data-reveal style={{ "--i": i } as CSSProperties}>
                <span className={styles.featureIcon}>
                  <Icon name={f.icon} size={22} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className={styles.section} aria-labelledby="how-title">
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>Как это работает</span>
            <h2 id="how-title" className={styles.sectionTitle}>
              Пять шагов до подтверждённого результата
            </h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={styles.step} data-reveal style={{ "--i": i } as CSSProperties}>
                <span className={styles.stepNum}>{i + 1}</span>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </section>


        <InstallPrompt />

        <section className={styles.final} aria-labelledby="final-title" data-reveal>
          <div>
            <h2 id="final-title">Готовы провести первый турнир?</h2>
            <p>Создайте турнир и следуйте подсказкам: они покажут, что осталось подготовить к первому поединку.</p>
          </div>
          <div className={styles.ctas}>{primaryCta}</div>
        </section>
      </main>
      <footer className={styles.footer}>
        <Brand />
        <span>Работает в локальной сети · данные поединков подтверждает сервер</span>
      </footer>
    </div>
  );
}

