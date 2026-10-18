"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Field, FormActions, FormGrid, Input } from "@/src/components/ui/Form/Form";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { useToast } from "@/src/components/ui/Toast/Toast";
import { api, errorText } from "@/src/lib/api";
import {
  usePreferences,
  type BackgroundPref,
  type DensityPref,
  type MotionPref,
  type Preferences,
  type ThemePref,
} from "@/src/lib/preferences";
import { useSession } from "@/src/lib/session";
import type { Me } from "@/src/lib/types";
import styles from "./SettingsPage.module.scss";

const THEMES: { value: ThemePref; label: string; icon: IconName; hint: string }[] = [
  { value: "dark", label: "Тёмная", icon: "moon", hint: "Глубокий тёмно-синий, как на табло" },
  { value: "light", label: "Светлая", icon: "sun", hint: "Для светлых помещений и печати" },
  { value: "system", label: "Как в системе", icon: "monitor", hint: "Следует настройке устройства" },
];

const BACKGROUNDS: { value: BackgroundPref; label: string }[] = [
  { value: "corners", label: "Углы ринга" },
  { value: "plain", label: "Без фона" },
  { value: "ring", label: "Сетка" },
  { value: "mat", label: "Татами" },
  { value: "octagon", label: "Октагон" },
];

const DENSITY: { value: DensityPref; label: string; hint: string }[] = [
  { value: "comfortable", label: "Обычная", hint: "Больше воздуха" },
  { value: "compact", label: "Компактная", hint: "Больше строк на экране" },
];

const MOTION: { value: MotionPref; label: string; hint: string }[] = [
  { value: "system", label: "Как в системе", hint: "Учитывает настройку устройства" },
  { value: "reduce", label: "Минимум", hint: "Без анимаций и переходов" },
  { value: "full", label: "Полная", hint: "Плавные переходы" },
];

const subscribeMedia = (cb: () => void) => {
  const m = window.matchMedia("(prefers-color-scheme: light)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

export function SettingsPage() {
  const { me } = useSession();
  return (
    <>
      <PageHeader title="Настройки" description="Внешний вид, предпочтения интерфейса и ваша учётная запись." />
      <div className={styles.layout}>
        <nav className={styles.toc} aria-label="Разделы настроек">
          <a href="#appearance">
            <Icon name="palette" size={18} />
            Внешний вид
          </a>
          <a href="#interface">
            <Icon name="sliders" size={18} />
            Интерфейс
          </a>
          <a href="#account">
            <Icon name="user" size={18} />
            Аккаунт
          </a>
        </nav>
        <Stack>
          <AppearanceSection />
          {me && <AccountSection me={me} />}
        </Stack>
      </div>
    </>
  );
}

function AppearanceSection() {
  const toast = useToast();
  const { prefs, save } = usePreferences();
  const [draft, setDraft] = useState<Preferences | null>(null);
  const value = draft ?? prefs;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(prefs);
  const systemLight = useSyncExternalStore(subscribeMedia, () => window.matchMedia("(prefers-color-scheme: light)").matches, () => false);
  const previewTheme = value.theme === "system" ? (systemLight ? "light" : "dark") : value.theme;
  const set = (patch: Partial<Preferences>) => setDraft({ ...value, ...patch });

  return (
    <>
      <Card title="Внешний вид" subtitle="Выберите вариант — он сразу появится в окне предпросмотра. Нажмите «Применить», чтобы сохранить.">
        <div id="appearance" className={styles.anchor} />
        <div className={styles.appearance}>
          <div className={styles.options}>
            <OptionGroup label="Тема">
              <div className={styles.themeGrid}>
                {THEMES.map((t) => (
                  <Choice key={t.value} name="theme" checked={value.theme === t.value} onChange={() => set({ theme: t.value })}>
                    <span className={`${styles.swatch} ${styles[`swatch_${t.value}`]}`} aria-hidden>
                      <Icon name={t.icon} size={18} />
                    </span>
                    <span className={styles.choiceText}>
                      <strong>{t.label}</strong>
                      <small>{t.hint}</small>
                    </span>
                  </Choice>
                ))}
              </div>
            </OptionGroup>
            <OptionGroup label="Фон">
              <div className={styles.bgGrid}>
                {BACKGROUNDS.map((b) => (
                  <Choice key={b.value} name="bg" checked={value.bg === b.value} onChange={() => set({ bg: b.value })} compact>
                    <span className={`${styles.bgThumb} ${styles[`bg_${b.value}`]}`} data-theme={previewTheme} aria-hidden />
                    <span className={styles.bgLabel}>{b.label}</span>
                  </Choice>
                ))}
              </div>
              <p className={styles.note}>Фоны встроены в приложение и работают без интернета. Карточки и таблицы остаются непрозрачными, поэтому текст читается на любом фоне.</p>
            </OptionGroup>
          </div>
          <Preview theme={previewTheme} bg={value.bg} density={value.density} />
        </div>
      </Card>

      <Card title="Предпочтения интерфейса" subtitle="Тоже видны в предпросмотре и применяются вместе с темой">
        <div id="interface" className={styles.anchor} />
        <div className={styles.prefGrid}>
          <OptionGroup label="Плотность таблиц и карточек">
            <div className={styles.inline}>
              {DENSITY.map((d) => (
                <Choice key={d.value} name="density" checked={value.density === d.value} onChange={() => set({ density: d.value })}>
                  <span className={styles.choiceText}>
                    <strong>{d.label}</strong>
                    <small>{d.hint}</small>
                  </span>
                </Choice>
              ))}
            </div>
          </OptionGroup>
          <OptionGroup label="Анимация">
            <div className={styles.inline}>
              {MOTION.map((m) => (
                <Choice key={m.value} name="motion" checked={value.motion === m.value} onChange={() => set({ motion: m.value })}>
                  <span className={styles.choiceText}>
                    <strong>{m.label}</strong>
                    <small>{m.hint}</small>
                  </span>
                </Choice>
              ))}
            </div>
          </OptionGroup>
        </div>
      </Card>

      <div className={`${styles.applyBar} ${dirty ? styles.applyBarActive : ""}`} role="region" aria-label="Применение настроек">
        <span>{dirty ? "Есть изменения, которые ещё не применены" : "Настройки внешнего вида хранятся в этом браузере"}</span>
        <div className={styles.applyActions}>
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={!dirty}>
            Отменить
          </Button>
          <Button
            variant="primary"
            disabled={!dirty}
            onClick={() => {
              save(value);
              setDraft(null);
              toast("Внешний вид применён и сохранён");
            }}
          >
            Применить
          </Button>
        </div>
      </div>
    </>
  );
}

function OptionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

function Choice({ name, checked, onChange, children, compact }: { name: string; checked: boolean; onChange: () => void; children: ReactNode; compact?: boolean }) {
  return (
    <label className={`${styles.choice} ${checked ? styles.checked : ""} ${compact ? styles.choiceCompact : ""}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="visually-hidden" />
      {children}
      {checked && (
        <span className={styles.tick} aria-hidden>
          <Icon name="check" size={14} />
        </span>
      )}
    </label>
  );
}

/** A miniature of the app rendered with the chosen (not yet applied) theme, background and density. */
function Preview({ theme, bg, density }: { theme: "dark" | "light"; bg: BackgroundPref; density: DensityPref }) {
  return (
    <figure className={styles.previewWrap}>
      <figcaption>Предпросмотр</figcaption>
      <div className={`${styles.preview} ${styles[`bg_${bg}`]}`} data-theme={theme} data-density={density}>
        <div className={styles.previewSide}>
          <span className={styles.previewBrand}>
            <i />
            <i />
          </span>
          <span className={styles.previewNavActive}>Турниры</span>
          <span>Поединки</span>
          <span>Правила</span>
        </div>
        <div className={styles.previewMain}>
          <div className={styles.previewTitle}>
            Кубок города
            <Badge tone="success">Идёт</Badge>
          </div>
          <div className={styles.previewCard}>
            <div className={styles.previewRow}>
              <span className={styles.red}>Иванов</span>
              <b>3 : 1</b>
              <span className={styles.blue}>Петров</span>
            </div>
            <div className={styles.previewRow}>
              <span className={styles.red}>Алиев</span>
              <b>—</b>
              <span className={styles.blue}>Сантус</span>
            </div>
          </div>
          <div className={styles.previewButtons}>
            <Button size="sm" variant="primary" tabIndex={-1}>
              Открыть
            </Button>
            <Button size="sm" tabIndex={-1}>
              Редактировать
            </Button>
          </div>
        </div>
      </div>
    </figure>
  );
}

function AccountSection({ me }: { me: Me }) {
  const toast = useToast();
  const { refresh, logout } = useSession();
  const [name, setName] = useState(me.user.displayName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const roles = [...new Set(me.roles.map((r) => r.name))];
  const mismatch = pw.repeat.length > 0 && pw.next !== pw.repeat;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setNameBusy(true);
    setNameError(null);
    try {
      await api.put("/auth/me", { displayName: name.trim() });
      await refresh();
      toast("Имя сохранено");
    } catch (err) {
      setNameError(errorText(err));
    } finally {
      setNameBusy(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwError(null);
    try {
      const r = await api.post<{ revokedSessions: number }>("/auth/password", { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: "", next: "", repeat: "" });
      toast(r.revokedSessions ? `Пароль изменён. Другие сеансы завершены: ${r.revokedSessions}` : "Пароль изменён");
    } catch (err) {
      setPwError(errorText(err));
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <Card title="Аккаунт" subtitle="Логин и роли меняет только администратор или организатор турнира">
      <div id="account" className={styles.anchor} />
      <dl className={styles.facts}>
        <div>
          <dt>Логин</dt>
          <dd>{me.user.login}</dd>
        </div>
        <div>
          <dt>Роли</dt>
          <dd className={styles.roles}>{roles.length ? roles.map((r) => <Badge key={r}>{r}</Badge>) : "Без роли"}</dd>
        </div>
      </dl>

      <form className={styles.accountForm} onSubmit={saveName}>
        <h3>Отображаемое имя</h3>
        {nameError && <Notice tone="error">{nameError}</Notice>}
        <FormGrid cols={2}>
          <Field label="Имя" hint="Видно в журнале действий и списках судей">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />}
          </Field>
        </FormGrid>
        <FormActions>
          <Button type="submit" variant="primary" loading={nameBusy} disabled={!name.trim() || name.trim() === me.user.displayName}>
            Сохранить имя
          </Button>
        </FormActions>
      </form>

      <form className={styles.accountForm} onSubmit={changePassword}>
        <h3>Пароль</h3>
        <p className={styles.note}>После смены пароля все другие сеансы этой учётной записи завершатся, текущий останется.</p>
        {pwError && <Notice tone="error">{pwError}</Notice>}
        <FormGrid cols={3}>
          <Field label="Текущий пароль">
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />}
          </Field>
          <Field label="Новый пароль" hint="Не короче 8 символов">
            {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />}
          </Field>
          <Field label="Повторите новый пароль" error={mismatch ? "Пароли не совпадают" : null}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={pw.repeat}
                onChange={(e) => setPw({ ...pw, repeat: e.target.value })}
                required
                aria-invalid={mismatch}
              />
            )}
          </Field>
        </FormGrid>
        <FormActions>
          <Button type="submit" variant="primary" loading={pwBusy} disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.repeat}>
            Сменить пароль
          </Button>
        </FormActions>
      </form>

      <div className={styles.logout}>
        <span>Выйти из учётной записи на этом устройстве</span>
        <Button onClick={logout}>
          <Icon name="logout" size={17} />
          Выйти
        </Button>
      </div>
    </Card>
  );
}
