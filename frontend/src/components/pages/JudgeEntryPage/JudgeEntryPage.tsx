"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicFrame } from "@/src/components/layout/PublicFrame/PublicFrame";
import { MatchStatusBadge } from "@/src/components/ui/Badge/Badge";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { Table } from "@/src/components/ui/Table/Table";
import { AuthForm } from "@/src/components/widgets/AuthForm/AuthForm";
import { api, currentUser, errorText } from "@/src/lib/api";
import type { MatchListItem, Me } from "@/src/lib/types";

const ACTIVE = new Set(["ready", "live", "awaiting_confirmation"]);

/**
 * Judge entry: sign in with the account an organizer issued, then pick an assigned match.
 * The list comes from the server; it only contains matches this user officiates.
 */
export function JudgeEntryPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [matches, setMatches] = useState<MatchListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    currentUser<Me>().then(
      (user) => {
        setError(null);
        setMe(user);
        if (!user) return;
        api.get<MatchListItem[]>("/matches").then(
          (all) => setMatches(all.filter((m) => m.is_official)),
          (e) => setError(errorText(e)),
        );
      },
      (e) => {
        setMe(null);
        setError(errorText(e));
      },
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const logout = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setMe(null);
    setMatches(null);
  };

  return (
    <PublicFrame icon="judge" title="Вход судьи" lead="Учётную запись судьи выдаёт организатор турнира. Самостоятельно получить права судьи нельзя.">
      {error && <Notice tone="error">{error}</Notice>}
      {me === undefined ? (
        <Loading />
      ) : me === null ? (
        <Card title="Войдите под учётной записью судьи">
          <AuthForm heading={false} onSuccess={() => load()} />
        </Card>
      ) : matches === null && !error ? (
        <Loading label="Загружаем назначенные поединки…" />
      ) : error && !matches ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <Card
          title={`Назначенные поединки · ${me.user.displayName}`}
          actions={
            <Button size="sm" variant="ghost" onClick={logout}>
              Сменить пользователя
            </Button>
          }
          flush
        >
          {matches && matches.length ? (
            <Table
              head={
                <tr>
                  <th>Поединок</th>
                  <th>Статус</th>
                  <th />
                </tr>
              }
            >
              {matches.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>№{m.match_number}</strong> · {m.red_name ?? "?"} — {m.blue_name ?? "?"}
                    <div>
                      {m.tournament_name} · {m.discipline_name}
                    </div>
                  </td>
                  <td>
                    <MatchStatusBadge status={m.status} />
                  </td>
                  <td>
                    {ACTIVE.has(m.status) ? (
                      <ButtonLink href={`/judge/${m.id}`} variant="primary" size="sm">
                        Судить
                      </ButtonLink>
                    ) : (
                      <ButtonLink href={`/matches/${m.id}`} size="sm">
                        Открыть
                      </ButtonLink>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="Вам пока не назначен ни один поединок">
              {me.capabilities.organizer
                ? "Вы вошли как организатор. Назначьте себя или другого судью в карточке поединка либо откройте панель управления."
                : "Попросите организатора назначить вас на поединок. Как только это произойдёт, обновите страницу."}
              {me.capabilities.organizer ? (
                <ButtonLink href="/dashboard" size="sm">
                  Панель организатора
                </ButtonLink>
              ) : (
                <Button size="sm" onClick={load}>
                  Обновить
                </Button>
              )}
            </Empty>
          )}
        </Card>
      )}
    </PublicFrame>
  );
}
