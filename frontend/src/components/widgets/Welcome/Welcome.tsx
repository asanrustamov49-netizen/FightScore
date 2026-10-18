import type { CSSProperties } from "react";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import styles from "./Welcome.module.scss";

const LATER: { icon: IconName; title: string }[] = [
  { icon: "users", title: "Участники" },
  { icon: "book", title: "Правила" },
  { icon: "judge", title: "Судьи" },
  { icon: "versus", title: "Поединки" },
  { icon: "display", title: "Табло" },
];

/**
 * First visit of an organizer without tournaments. Shown only while the server reports no tournaments, so it
 * disappears by itself after the first one and never greets the user again. Only the first step is explained in
 * detail; the rest become the tournament's checklist once it exists.
 */
export function Welcome({ name }: { name: string }) {
  return (
    <section className={styles.welcome} aria-labelledby="welcome-title">
      <div className={styles.hero}>
        <span className={styles.kicker}>
          <Icon name="sparkle" size={15} />
          Первые шаги
        </span>
        <h1 id="welcome-title" className={styles.title}>
          Добро пожаловать, {name}
        </h1>
        <p className={styles.lead}>
          Здесь вы готовите и проводите соревнования: турниры, участники, правила, судьи, поединки и табло. Всё начинается с турнира — остальное появится внутри
          него.
        </p>
        <div className={styles.actions}>
          <ButtonLink href="/tournaments?new=1" variant="primary" size="lg">
            <Icon name="plus" size={18} />
            Создать первый турнир
          </ButtonLink>
          <ButtonLink href="/rules" size="lg">
            Посмотреть правила
          </ButtonLink>
        </div>
      </div>

      <div className={styles.path}>
        <div className={styles.current}>
          <span className={styles.stepNo}>1</span>
          <div>
            <strong>Создайте турнир</strong>
            <p>Укажите название, даты, место и дисциплины. Турнир можно сохранить черновиком и опубликовать, когда всё будет готово.</p>
          </div>
        </div>
        <div className={styles.laterHead}>Потом на странице турнира</div>
        <ol className={styles.later}>
          {LATER.map((s, i) => (
            <li key={s.title} style={{ "--i": i } as CSSProperties}>
              <span className={styles.laterIcon}>
                <Icon name={s.icon} size={18} />
              </span>
              {s.title}
            </li>
          ))}
        </ol>
        <p className={styles.laterNote}>Турнир сам подскажет, что уже готово и какой шаг следующий.</p>
      </div>
    </section>
  );
}
