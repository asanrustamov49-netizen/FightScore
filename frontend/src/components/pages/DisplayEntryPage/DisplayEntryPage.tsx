"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PublicFrame } from "@/src/components/layout/PublicFrame/PublicFrame";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Field, FormActions, formClass, Input } from "@/src/components/ui/Form/Form";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { Table } from "@/src/components/ui/Table/Table";
import { api, currentUser } from "@/src/lib/api";
import type { DisplayItem, Me } from "@/src/lib/types";

/** Accepts a full display link (…/display/<token>) or just the token. */
function extractToken(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const match = value.match(/\/display\/([A-Za-z0-9_-]{16,100})/);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{16,100}$/.test(value) ? value : null;
}

/**
 * Public TV entry. Viewers need no account: the organizer's display link is the access key, and it
 * only opens a read-only view. Signed-in operators also see the displays they may open.
 */
export function DisplayEntryPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [displays, setDisplays] = useState<DisplayItem[] | null>(null);

  useEffect(() => {
    currentUser<Me>().then(
      (me) => {
        if (me?.capabilities.displays) api.get<DisplayItem[]>("/displays").then(setDisplays, () => setDisplays(null));
      },
      () => undefined,
    );
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const token = extractToken(value);
    if (!token) {
      setError("Не похоже на ссылку табло. Скопируйте ссылку целиком из раздела «Табло» у организатора.");
      return;
    }
    router.push(`/display/${token}`);
  }

  return (
    <PublicFrame
      icon="display"
      title="Открыть табло"
      lead="Экран трансляции для телевизора: только просмотр, вход не нужен. Ссылку на табло даёт организатор турнира."
    >
      <Card title="Ссылка на табло">
        <form className={formClass} onSubmit={submit}>
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Ссылка или код табло" hint="Например: http://192.168.1.10:3000/display/… — у организатора в разделе «Табло» есть кнопка «Копировать ссылку»">
            {(id) => (
              <Input
                id={id}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <FormActions>
            <Button type="submit" variant="primary" size="lg">
              Открыть на этом экране
            </Button>
          </FormActions>
        </form>
      </Card>
      {displays && displays.length > 0 && (
        <Card title="Ваши табло" flush>
          <Table
            head={
              <tr>
                <th>Табло</th>
                <th>Поединок</th>
                <th />
              </tr>
            }
          >
            {displays.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.name}</strong>
                  <div>{d.tournament_name}</div>
                </td>
                <td>{d.match_number ? `№${d.match_number}` : "не выбран"}</td>
                <td>
                  <ButtonLink href={`/display/${d.public_token}`} variant="primary" size="sm">
                    Открыть
                  </ButtonLink>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Notice tone="info">
        На телевизоре откройте табло, нажмите «На весь экран» и оставьте страницу открытой: счёт и время обновятся сами. Если связь пропадёт,
        на экране появится предупреждение.
      </Notice>
    </PublicFrame>
  );
}
