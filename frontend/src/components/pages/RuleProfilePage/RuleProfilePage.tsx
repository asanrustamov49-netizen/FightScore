"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge, RuleKindBadge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { ConfirmDialog, DialogText } from "@/src/components/ui/Dialog/Dialog";
import { Field, FormActions, FormGrid, Input, Textarea } from "@/src/components/ui/Form/Form";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { MetaItem, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { useToast } from "@/src/components/ui/Toast/Toast";
import { RulePreview } from "@/src/components/widgets/RulePreview/RulePreview";
import { RuleVersionForm, versionErrors, versionPayload, type RuleVersionValue } from "@/src/components/widgets/RuleVersionForm/RuleVersionForm";
import { api, errorText } from "@/src/lib/api";
import { formatDate, formatDateTime, plural } from "@/src/lib/format";
import type { RuleProfileDetail, RuleVersionDetail } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./RuleProfilePage.module.scss";

export function versionStatusLabel(v: { status: RuleVersionDetail["status"]; is_demo: boolean }) {
  if (v.status === "draft") return "Черновик";
  if (v.status === "archived") return "В архиве";
  return v.is_demo ? "Опубликована" : "Утверждена";
}

function VersionStatus({ v }: { v: RuleVersionDetail }) {
  return <Badge tone={v.status === "approved" ? "success" : v.status === "draft" ? "warning" : "neutral"}>{versionStatusLabel(v)}</Badge>;
}

function toValue(v: RuleVersionDetail): RuleVersionValue {
  return {
    official: !v.is_demo,
    definition: structuredClone(v.definition),
    changeSummary: v.change_summary ?? "",
    sourceTitle: v.source_title ?? "",
    sourceEdition: v.source_edition ?? "",
    sourceUrl: v.source_url ?? "",
    sourcePublishedOn: v.source_published_on?.slice(0, 10) ?? "",
    effectiveFrom: v.effective_from?.slice(0, 10) ?? "",
  };
}

type Dialog = "publish" | "delete" | "archiveVersion" | "archiveProfile" | null;

export function RuleProfilePage() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const profile = useResource<RuleProfileDetail>(`/rule-profiles/${id}`);
  const [editingMeta, setEditingMeta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [draft, setDraft] = useState<{ versionId: string; value: RuleVersionValue } | null>(null);

  if (profile.loading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorState message={profile.error ?? "Профиль не найден"} onRetry={profile.reload} />;
  const p = profile.data;
  const draftVersion = p.versions.find((v) => v.status === "draft");
  // Selected version: from the URL, otherwise the draft for its editors, otherwise the current approved one.
  const selected: RuleVersionDetail | undefined =
    p.versions.find((v) => v.id === query.get("v")) ??
    (p.can_edit ? draftVersion : undefined) ??
    p.versions.find((v) => v.status === "approved") ??
    p.versions[0];
  const editable = !!selected && selected.status === "draft" && p.can_edit && !p.archived_at;
  const value = editable ? (draft?.versionId === selected.id ? draft.value : toValue(selected)) : null;
  const dirty = !!value && JSON.stringify(versionPayload(value)) !== JSON.stringify(versionPayload(toValue(selected!)));
  const errors = value ? versionErrors(value) : [];
  const cannotApprove = !!value?.official && !p.abilities.approveOfficial;

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await profile.reload();
      toast(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const saveDraft = () => api.put(`/rule-versions/${selected!.id}`, versionPayload(value!)).then(() => setDraft(null));
  const select = (versionId: string) => router.replace(`${pathname}?v=${versionId}`, { scroll: false });

  async function duplicate() {
    setBusy(true);
    setError(null);
    try {
      const copy = await api.post<{ id: string }>(`/rule-profiles/${id}/duplicate`, { versionId: selected?.id });
      toast("Копия создана как черновик");
      router.push(`/rules/${copy.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  async function newVersion() {
    setBusy(true);
    setError(null);
    try {
      const v = await api.post<{ id: string; versionNumber: number }>(`/rule-profiles/${id}/versions`, { fromVersionId: selected?.id });
      await profile.reload();
      toast(`Создан черновик версии ${v.versionNumber}`);
      select(v.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Профили правил", href: "/rules" }]}
        title={
          <>
            {p.name}
            {selected && <RuleKindBadge demo={selected.is_demo} />}
            {p.visibility === "private" && <Badge title="Виден только автору и организаторам системы">Личный</Badge>}
            {p.archived_at && <Badge>В архиве</Badge>}
          </>
        }
        meta={
          <>
            <MetaItem icon="versus">{p.discipline_name}</MetaItem>
            {p.author_name && <MetaItem icon="user">Автор: {p.author_name}</MetaItem>}
            <MetaItem icon="calendar">Создан {formatDate(p.created_at)}</MetaItem>
          </>
        }
        description={p.description ?? undefined}
        actions={
          <>
            {p.can_edit && !p.archived_at && (
              <Button onClick={() => setEditingMeta((x) => !x)} aria-expanded={editingMeta}>
                <Icon name="edit" size={17} />
                Название и описание
              </Button>
            )}
            {p.abilities.create && (
              <Button onClick={() => void duplicate()} disabled={busy}>
                <Icon name="copy" size={17} />
                Дублировать
              </Button>
            )}
            {p.can_edit &&
              (p.archived_at ? (
                <Button onClick={() => void run(() => api.post(`/rule-profiles/${id}/restore`), "Профиль возвращён из архива")}>Вернуть из архива</Button>
              ) : (
                <Button variant="danger" onClick={() => setDialog("archiveProfile")}>
                  <Icon name="archive" size={17} />В архив
                </Button>
              ))}
          </>
        }
      />
      <Stack>
        {p.archived_at && <Notice tone="info">Профиль в архиве: его нельзя выбрать для новых поединков. Поединки, которые уже его используют, сохраняют свою версию.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {editingMeta && <MetaForm profile={p} onCancel={() => setEditingMeta(false)} onSaved={() => (setEditingMeta(false), void profile.reload(), toast("Профиль сохранён"))} />}

        <div className={styles.layout}>
          <div className={styles.main}>
            {!selected ? (
              <Card>
                <p className={styles.muted}>У профиля нет версий.</p>
              </Card>
            ) : editable && value ? (
              <>
                <Card>
                  <div className={styles.versionHead}>
                    <div>
                      <h2>
                        Версия {selected.version_number} <VersionStatus v={selected} />
                      </h2>
                      <p className={styles.muted}>
                        Черновик можно менять сколько угодно. После публикации версия станет неизменяемой, и её можно будет выбрать в поединке.
                      </p>
                    </div>
                    <div className={styles.versionActions}>
                      {p.versions.length > 1 && (
                        <Button variant="ghost" onClick={() => setDialog("delete")} disabled={busy}>
                          <Icon name="trash" size={17} />
                          Удалить черновик
                        </Button>
                      )}
                      <Button onClick={() => void run(saveDraft, "Черновик сохранён")} loading={busy && dialog === null} disabled={!dirty || busy}>
                        {dirty ? "Сохранить черновик" : "Сохранено"}
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => setDialog("publish")}
                        disabled={busy || errors.length > 0 || cannotApprove}
                        title={cannotApprove ? "Утвердить официальный регламент может только владелец системы" : undefined}
                      >
                        <Icon name="check" size={17} />
                        {value.official ? "Утвердить" : "Опубликовать"}
                      </Button>
                    </div>
                  </div>
                  {cannotApprove && (
                    <Notice tone="info">
                      Это официальный регламент: утвердить его может только владелец системы. Вы можете сохранить черновик, а утверждение выполнит владелец.
                    </Notice>
                  )}
                </Card>
                <RuleVersionForm value={value} onChange={(v) => setDraft({ versionId: selected.id, value: v })} canMarkOfficial={p.abilities.manageAll} disabled={busy} />
              </>
            ) : (
              <>
                <Card>
                  <div className={styles.versionHead}>
                    <div>
                      <h2>
                        Версия {selected.version_number} <VersionStatus v={selected} />
                      </h2>
                      <p className={styles.muted}>
                        {selected.status === "draft"
                          ? "Черновик редактирует автор профиля или организатор системы."
                          : "Опубликованная версия неизменяема. Чтобы изменить правила, создайте новую версию — уже созданные поединки останутся на этой."}
                      </p>
                    </div>
                    <div className={styles.versionActions}>
                      {selected.status === "approved" && p.can_edit && (
                        <Button variant="ghost" onClick={() => setDialog("archiveVersion")} disabled={busy}>
                          <Icon name="archive" size={17} />
                          Архивировать версию
                        </Button>
                      )}
                      {p.can_edit && !p.archived_at && !draftVersion && (
                        <Button variant="primary" onClick={() => void newVersion()} loading={busy}>
                          <Icon name="plus" size={17} />
                          Новая версия на основе этой
                        </Button>
                      )}
                      {p.can_edit && draftVersion && draftVersion.id !== selected.id && (
                        <Button variant="primary" onClick={() => select(draftVersion.id)}>
                          Открыть черновик v{draftVersion.version_number}
                        </Button>
                      )}
                    </div>
                  </div>
                  <dl className={styles.facts}>
                    <div>
                      <dt>Действует с</dt>
                      <dd>{formatDate(selected.effective_from)}</dd>
                    </div>
                    <div>
                      <dt>{selected.is_demo ? "Опубликовал" : "Утвердил"}</dt>
                      <dd>{selected.approved_at ? `${selected.approved_by_name ?? "—"}, ${formatDateTime(selected.approved_at)}` : "—"}</dd>
                    </div>
                    <div>
                      <dt>Используется</dt>
                      <dd>
                        {selected.matches_count} {plural(selected.matches_count, ["поединок", "поединка", "поединков"])}
                      </dd>
                    </div>
                    <div>
                      <dt>Движок</dt>
                      <dd>
                        {selected.engine}@{selected.engine_version}
                      </dd>
                    </div>
                  </dl>
                  {!selected.is_demo && (
                    <p className={styles.source}>
                      Источник: {selected.source_title}, {selected.source_edition}
                      {selected.source_published_on && ` от ${formatDate(selected.source_published_on)}`}
                      {selected.source_url && (
                        <>
                          {" · "}
                          <a href={selected.source_url} target="_blank" rel="noreferrer">
                            документ
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  {selected.change_summary && <p className={styles.muted}>Изменения: {selected.change_summary}</p>}
                </Card>
                <Card title="Параметры версии">
                  <RulePreview definition={selected.definition} />
                </Card>
              </>
            )}
          </div>

          <aside className={styles.side}>
            <Card title="Версии" subtitle="Поединок хранит ту версию, с которой создан" flush>
              <ul className={styles.versions}>
                {p.versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" className={`${styles.versionRow} ${v.id === selected?.id ? styles.current : ""}`} onClick={() => select(v.id)} aria-current={v.id === selected?.id ? "true" : undefined}>
                      <span className={styles.versionNum}>v{v.version_number}</span>
                      <span className={styles.versionInfo}>
                        <VersionStatus v={v} />
                        <small>
                          {v.status === "draft" ? `создан ${formatDate(v.created_at)}` : `с ${formatDate(v.effective_from)}`} · {v.matches_count}{" "}
                          {plural(v.matches_count, ["поединок", "поединка", "поединков"])}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Как использовать">
              <ol className={styles.howto}>
                <li>Опубликуйте версию.</li>
                <li>
                  Откройте <Link href="/tournaments">турнир</Link> с дисциплиной «{p.discipline_name}».
                </li>
                <li>Во вкладке «Поединки» нажмите «Новый поединок» и выберите эту версию в поле «Версия правил».</li>
              </ol>
            </Card>
          </aside>
        </div>
      </Stack>

      <ConfirmDialog
        open={dialog === "publish"}
        title={value?.official ? "Утвердить официальный регламент?" : "Опубликовать версию?"}
        confirmLabel={value?.official ? "Утвердить" : "Опубликовать"}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          void run(async () => {
            if (dirty) await saveDraft();
            await api.post(`/rule-versions/${selected!.id}/publish`);
          }, value?.official ? "Регламент утверждён" : "Версия опубликована").then((ok) => ok && setDialog(null))
        }
      >
        <DialogText>
          После публикации версию нельзя изменить или удалить — только отправить в архив. Её можно будет выбрать при создании поединка.
          {dirty && " Несохранённые изменения будут сохранены перед публикацией."}
        </DialogText>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "delete"}
        title="Удалить черновик?"
        confirmLabel="Удалить"
        confirmVariant="danger"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          void run(() => api.del(`/rule-versions/${selected!.id}`), "Черновик удалён").then((ok) => {
            if (ok) {
              setDialog(null);
              router.replace(pathname, { scroll: false });
            }
          })
        }
      >
        <DialogText>Черновик версии {selected?.version_number} будет удалён. Опубликованные версии не затрагиваются.</DialogText>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "archiveVersion"}
        title="Архивировать версию?"
        confirmLabel="В архив"
        confirmVariant="danger"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void run(() => api.post(`/rule-versions/${selected!.id}/archive`), "Версия отправлена в архив").then((ok) => ok && setDialog(null))}
      >
        <DialogText>
          Версию нельзя будет выбрать для новых поединков. {selected?.matches_count ? `${selected.matches_count} ${plural(selected.matches_count, ["поединок", "поединка", "поединков"])} сохранят её без изменений.` : ""}
        </DialogText>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "archiveProfile"}
        title="Отправить профиль в архив?"
        confirmLabel="В архив"
        confirmVariant="danger"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void run(() => api.post(`/rule-profiles/${id}/archive`), "Профиль отправлен в архив").then((ok) => ok && setDialog(null))}
      >
        <DialogText>Профиль пропадёт из выбора для новых поединков. Существующие поединки сохранят свои версии. Профиль можно вернуть из архива.</DialogText>
      </ConfirmDialog>
    </>
  );
}

function MetaForm({ profile, onCancel, onSaved }: { profile: RuleProfileDetail; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Название и описание" subtitle="Название видно в выборе правил и в карточке поединка">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.put(`/rule-profiles/${profile.id}`, { name: name.trim(), description: description.trim() || null });
            onSaved();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <FormGrid cols={2}>
          <Field label="Название">{(fid) => <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={120} required />}</Field>
          <Field label="Описание">{(fid) => <Textarea id={fid} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />}</Field>
        </FormGrid>
        <FormActions>
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={name.trim().length < 3}>
            Сохранить
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
