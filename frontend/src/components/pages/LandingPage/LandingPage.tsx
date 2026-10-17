"use client";

import { useEffect, useState } from "react";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { InstallPrompt } from "@/src/components/widgets/InstallPrompt/InstallPrompt";
import { api, currentUser } from "@/src/lib/api";
import type { AuthOptions, Me } from "@/src/lib/types";
import styles from "./LandingPage.module.scss";

/** Public start page: three entry points by role. Nothing here needs an account. */
export function LandingPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [registration, setRegistration] = useState(false);

  useEffect(() => {
    currentUser<Me>().then(setMe, () => setMe(null));
    api.get<AuthOptions>("/auth/options").then((o) => setRegistration(o.registration), () => setRegistration(false));
  }, []);

  const isOrganizer = !!me?.capabilities.organizer;

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Brand />
        <div className={styles.who}>
          {me ? (
            <>
              <span>Вы вошли как {me.user.displayName}</span>
              <ButtonLink href="/dashboard" size="sm">
                Панель
              </ButtonLink>
            </>
          ) : (
            me === null && (
              <ButtonLink href="/login" size="sm" variant="ghost">
                Войти
              </ButtonLink>
            )
          )}
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <span className={styles.eyebrow}>Судейство и табло для единоборств</span>
          <h1 className={styles.title}>
            Счёт, время и результат — <span className={styles.accentRed}>в одном</span> <span className={styles.accentBlue}>месте</span>
          </h1>
          <p className={styles.lead}>
            FightScore ведёт турнир от регистрации спортсменов до подтверждённого результата. Судья управляет поединком с ноутбука, зрители видят
            счёт и таймер на телевизоре. Сервер хранит каждое действие в журнале и работает в локальной сети.
          </p>
        </section>

        <section className={styles.cards} aria-label="Выберите, кто вы">
          <article className={`${styles.card} ${styles.organizer}`}>
            <span className={styles.iconBox}>
              <Icon name="organizer" size={28} />
            </span>
            <h2 className={styles.cardTitle}>Организатор</h2>
            <p className={styles.cardText}>Создайте турнир, добавьте спортсменов, соберите поединки, назначьте судей и выведите поединок на табло.</p>
            <ul className={styles.points}>
              <li>Турниры, участники и поединки</li>
              <li>Аккаунты судей своего турнира</li>
              <li>Результаты и журнал действий</li>
            </ul>
            <div className={styles.actions}>
              {isOrganizer ? (
                <ButtonLink href="/dashboard" variant="primary">
                  Открыть панель
                </ButtonLink>
              ) : (
                <>
                  {registration && (
                    <ButtonLink href="/login?mode=register&next=/tournaments" variant="primary">
                      Создать турнир
                    </ButtonLink>
                  )}
                  <ButtonLink href="/login?next=/dashboard" variant={registration ? "secondary" : "primary"}>
                    Войти
                  </ButtonLink>
                </>
              )}
            </div>
          </article>

          <article className={`${styles.card} ${styles.judge}`}>
            <span className={styles.iconBox}>
              <Icon name="judge" size={28} />
            </span>
            <h2 className={styles.cardTitle}>Судья</h2>
            <p className={styles.cardText}>Войдите под учётной записью, которую выдал организатор, и откройте назначенный вам поединок.</p>
            <ul className={styles.points}>
              <li>Только назначенные поединки</li>
              <li>Счёт, таймер и нарушения по профилю правил</li>
              <li>Каждое действие подтверждает сервер</li>
            </ul>
            <div className={styles.actions}>
              <ButtonLink href="/judge" variant="primary">
                Мои поединки
              </ButtonLink>
            </div>
          </article>

          <article className={`${styles.card} ${styles.display}`}>
            <span className={styles.iconBox}>
              <Icon name="display" size={28} />
            </span>
            <h2 className={styles.cardTitle}>Табло</h2>
            <p className={styles.cardText}>Откройте на телевизоре экран трансляции: имена, красный и синий углы, счёт, таймер и статус поединка.</p>
            <ul className={styles.points}>
              <li>Без входа — по ссылке от организатора</li>
              <li>Обновляется сам, без перезагрузки</li>
              <li>Только просмотр, управлять нельзя</li>
            </ul>
            <div className={styles.actions}>
              <ButtonLink href="/display" variant="primary">
                Открыть табло
              </ButtonLink>
            </div>
          </article>
        </section>

        <InstallPrompt />

        <section className={styles.facts} aria-label="Как работает FightScore">
          <div className={styles.fact}>
            <strong>Сервер — источник истины</strong>
            Счёт и время считаются на сервере, судейские планшеты и табло показывают подтверждённое состояние.
          </div>
          <div className={styles.fact}>
            <strong>Разграничение прав</strong>
            Организатор видит только свои турниры, судья — только назначенные поединки, табло — только публичные данные.
          </div>
          <div className={styles.fact}>
            <strong>Локальная сеть</strong>
            Сервер можно запустить на компьютере организатора; потеря связи сразу видна на всех экранах.
          </div>
        </section>
      </main>
      <footer className={styles.footer}>FightScore · рабочее название</footer>
    </div>
  );
}
