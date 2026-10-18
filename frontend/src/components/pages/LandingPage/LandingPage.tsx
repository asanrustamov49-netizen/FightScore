"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { InstallPrompt } from "@/src/components/widgets/InstallPrompt/InstallPrompt";
import { api, currentUser } from "@/src/lib/api";
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
          <a href="#features">Возможности</a>
          <a href="#how">Как это работает</a>
          <a href="#roles">Для кого</a>
        </nav>
        <div className={styles.who}>
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
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <span className={styles.chip} style={{ "--i": 0 } as CSSProperties}>
              <Icon name="bolt" size={15} />
              Судейство и табло для единоборств
            </span>
            <h1 className={styles.title} style={{ "--i": 1 } as CSSProperties}>
              Турнир под контролем — <span className={styles.gradientText}>от заявки до результата</span>
            </h1>
            <p className={styles.lead} style={{ "--i": 2 } as CSSProperties}>
              FightScore помогает организаторам соревнований по единоборствам вести турниры, участников и поединки. Судья управляет счётом с ноутбука, зрители
              видят табло на телевизоре, а сервер подтверждает и записывает каждое действие.
            </p>
            <div className={styles.ctas} style={{ "--i": 3 } as CSSProperties}>
              {primaryCta}
            </div>
            <div className={styles.quick} style={{ "--i": 4 } as CSSProperties}>
              <Link href="/judge">
                <Icon name="judge" size={16} />Я судья
              </Link>
              <Link href="/display">
                <Icon name="display" size={16} />
                Открыть табло
              </Link>
            </div>
          </div>

          <HeroVisual />
        </section>

        <section id="features" className={styles.section} aria-labelledby="features-title">
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>Возможности</span>
            <h2 id="features-title" className={styles.sectionTitle}>
              Всё, что нужно для проведения соревнований
            </h2>
            <p className={styles.sectionLead}>Без таблиц, ручного табло и споров о том, кто и когда изменил счёт.</p>
          </div>
          <div className={styles.features}>
            {FEATURES.map((f, i) => (
              <article key={f.title} className={styles.feature} style={{ "--i": i } as CSSProperties}>
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
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>Как это работает</span>
            <h2 id="how-title" className={styles.sectionTitle}>
              Пять шагов до подтверждённого результата
            </h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={styles.step} style={{ "--i": i } as CSSProperties}>
                <span className={styles.stepNum}>{i + 1}</span>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section id="roles" className={styles.section} aria-labelledby="roles-title">
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>Для кого</span>
            <h2 id="roles-title" className={styles.sectionTitle}>
              Каждый видит только своё
            </h2>
            <p className={styles.sectionLead}>Права проверяет сервер: организатор, судья и зритель работают в одной системе, не мешая друг другу.</p>
          </div>
          <div className={styles.roles}>
            <RoleCard
              icon="organizer"
              tone="blue"
              title="Организатор"
              text="Создаёт турниры, регистрирует участников, собирает поединки и назначает судей."
              points={["Только свои турниры", "Аккаунты судей турнира", "Результаты и журнал"]}
              action={
                me?.capabilities.organizer ? (
                  <ButtonLink href="/dashboard" variant="primary">
                    Открыть панель
                  </ButtonLink>
                ) : (
                  <ButtonLink href={startHref} variant="primary">
                    {registration ? "Создать аккаунт" : "Войти"}
                  </ButtonLink>
                )
              }
            />
            <RoleCard
              icon="judge"
              tone="red"
              title="Судья"
              text="Входит под учётной записью от организатора и ведёт назначенный поединок."
              points={["Только назначенные поединки", "Счёт и нарушения по правилам", "Каждое действие подтверждено"]}
              action={<ButtonLink href="/judge">Мои поединки</ButtonLink>}
            />
            <RoleCard
              icon="display"
              tone="green"
              title="Зритель"
              text="Смотрит табло на телевизоре или экране: имена, углы, счёт, таймер и статус."
              points={["Без входа, по ссылке", "Обновляется само", "Только просмотр"]}
              action={<ButtonLink href="/display">Открыть табло</ButtonLink>}
            />
          </div>
        </section>

        <InstallPrompt />

        <section className={styles.final} aria-labelledby="final-title">
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

function RoleCard({
  icon,
  tone,
  title,
  text,
  points,
  action,
}: {
  icon: IconName;
  tone: "blue" | "red" | "green";
  title: string;
  text: string;
  points: string[];
  action: React.ReactNode;
}) {
  return (
    <article className={`${styles.role} ${styles[tone]}`}>
      <span className={styles.roleIcon}>
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <ul>
        {points.map((p) => (
          <li key={p}>
            <Icon name="check" size={16} />
            {p}
          </li>
        ))}
      </ul>
      <div className={styles.roleAction}>{action}</div>
    </article>
  );
}

/**
 * Illustration of the product, drawn with HTML/CSS (no images, works offline).
 * It is a static picture: no real athletes, scores or matches.
 */
function HeroVisual() {
  return (
    <div className={styles.visual} aria-hidden>
      <div className={styles.board}>
        <div className={styles.boardTop}>
          <span className={styles.boardLabel}>Пример табло</span>
          <span className={styles.boardPeriod}>Период 2 из 3</span>
          <span className={styles.boardLive}>
            <i />
            Идёт
          </span>
        </div>
        <div className={styles.boardBody}>
          <div className={`${styles.corner} ${styles.cornerRed}`}>
            <span className={styles.cornerName}>Красный угол</span>
            <span className={styles.cornerScore}>5</span>
          </div>
          <div className={styles.clock}>
            <span>02:41</span>
            <small>осталось</small>
          </div>
          <div className={`${styles.corner} ${styles.cornerBlue}`}>
            <span className={styles.cornerName}>Синий угол</span>
            <span className={styles.cornerScore}>3</span>
          </div>
        </div>
      </div>

      <div className={`${styles.float} ${styles.floatJudge}`}>
        <span className={styles.floatTitle}>
          <Icon name="judge" size={15} />
          Судейская панель
        </span>
        <div className={styles.padRow}>
          <span className={styles.padRed}>+1</span>
          <span className={styles.padRed}>+2</span>
          <span className={styles.padBlue}>+1</span>
          <span className={styles.padBlue}>+2</span>
        </div>
      </div>

      <div className={`${styles.float} ${styles.floatLog}`}>
        <span className={styles.logIcon}>
          <Icon name="check" size={14} />
        </span>
        <span>
          <strong>Сервер подтвердил</strong>
          <small>+2 красному углу · записано в журнал</small>
        </span>
      </div>
    </div>
  );
}
