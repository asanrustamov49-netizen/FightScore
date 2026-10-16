# FightScore — схема PostgreSQL

- **Статус:** черновик этапа 1, ждёт утверждения.
- **Основа:** [PROJECT_SPEC.md §9](PROJECT_SPEC.md#9-модель-данных), [ARCHITECTURE.md](ARCHITECTURE.md).
- Схема — проектная. Финальный DDL пишется в миграциях на этапах 2–7. Изменения схемы после утверждения вносятся сюда же.

## 1. Общие соглашения

| Тема | Решение |
|---|---|
| Версия PostgreSQL | **≥ 15** (нужен `UNIQUE NULLS NOT DISTINCT`). Рекомендуется последняя стабильная на момент установки. |
| Идентификаторы | Единый тип `uuid` для всех сущностей (ТЗ §9), `DEFAULT gen_random_uuid()`. Естественные ключи (ISO-код, логин) — отдельные `UNIQUE`-колонки. Исключение — служебная `schema_migrations`. |
| Время | `timestamptz`, в БД хранится UTC. Серверное «сейчас» — `now()` внутри транзакции. Календарные даты без времени (дата рождения, даты турнира) — `date`. |
| Обязательные метки | `created_at timestamptz NOT NULL DEFAULT now()` у всех таблиц. `updated_at` — у изменяемых, обновляется кодом репозитория (без триггеров «на всё»). |
| Имена | `snake_case`, таблицы во множественном числе, FK — `<entity>_id`. |
| Перечисления | `text` + `CHECK (col IN (...))`, а не `CREATE TYPE … ENUM`: добавление значения — простая миграция, без ограничений `ALTER TYPE` в транзакции. Список значений дублируется в contracts. |
| Удаление | По умолчанию `ON DELETE RESTRICT`. Справочники и турниры архивируются (`archived_at`), а не удаляются. `CASCADE` только для чистых дочерних строк без исторической ценности (явно указано ниже). |
| Регистр строк | Уникальность без учёта регистра — уникальный индекс по `lower(col)`. Расширение `citext` не нужно. |
| JSONB | Только там, где структура задаётся профилем правил (`definition`, счёт, payload события). Форма JSONB проверяется zod-схемой в backend до записи. |
| Append-only | `match_events`, `audit_log`: триггер `BEFORE UPDATE OR DELETE` → `RAISE EXCEPTION`. |
| Расширения | Не требуются (`gen_random_uuid()` встроена с PG 13). |

## 2. Схема связей

```
users ─┬─< user_identities
       ├─< sessions
       ├─< user_role_assignments >── roles ──< role_permissions
       │          └── (tournament_id) ──┐
       └─< match_officials              │
                                        ▼
countries ──< clubs              tournaments ─┬─< tournament_disciplines >── disciplines
    │            │                            ├─< tournament_rule_versions >── rule_profile_versions
    └──< athletes >┘                          ├─< categories
            │                                 ├─< tournament_athletes >── athletes
            │                                 ├─< matches
            │                                 └─< displays
disciplines ──< rule_profiles ──< rule_profile_versions

matches ─┬─< match_participants >── tournament_athletes
         ├─< match_officials
         ├── match_states       (1:1)
         ├─< match_events
         ├── match_results      (0..1)
         └── rule_profile_versions (FK, неизменяемая версия)

audit_log — ссылается на актора и сущность (без FK на сущность, см. §3.7)
```

## 3. Таблицы

Обозначения: **PK** — первичный ключ, **FK** — внешний ключ, **U** — уникальность, **C** — CHECK, **IX** — индекс.

### 3.1. Пользователи, сессии, права

**`users`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| login | text NOT NULL | U `lower(login)` |
| display_name | text NOT NULL | |
| password_hash | text NULL | `scrypt$N$r$p$salt$hash`. NULL — вход только через Google. |
| is_active | boolean NOT NULL DEFAULT true | Деактивация вместо удаления. |
| last_login_at | timestamptz NULL | |
| created_at, updated_at | timestamptz | |

**`user_identities`** — внешние идентичности (Google).
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users ON DELETE CASCADE | |
| provider | text NOT NULL | C `IN ('google')` |
| provider_subject | text NOT NULL | `sub` из ID-токена |
| email | text NULL | Для отображения, не для поиска |
| created_at | timestamptz | |

U `(provider, provider_subject)`; IX `(user_id)`.

**`sessions`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users ON DELETE CASCADE | |
| token_hash | bytea NOT NULL | SHA-256 токена из cookie, U |
| created_at | timestamptz | |
| last_seen_at | timestamptz NOT NULL | Скользящее продление |
| expires_at | timestamptz NOT NULL | Абсолютный срок |
| revoked_at | timestamptz NULL | |
| ip | inet NULL, user_agent text NULL | Для аудита входов |

IX `(user_id)`, IX `(expires_at)` для очистки. Просроченные сессии удаляются периодически. Факт входа и выхода остаётся в `audit_log`.

**`roles`** — справочник, наполняется миграцией.
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| code | text NOT NULL U | `owner`, `organizer`, `chief_judge`, `judge`, `display_operator` |
| name | text NOT NULL | |
| is_system | boolean NOT NULL | Системные роли не удаляются |

**`role_permissions`**
| Колонка | Тип | Примечание |
|---|---|---|
| role_id | uuid FK → roles ON DELETE CASCADE | |
| permission | text NOT NULL | Код права из contracts |

PK `(role_id, permission)`.

**`user_role_assignments`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| role_id | uuid FK → roles | |
| scope_type | text NOT NULL | C `IN ('system','tournament')`. Значение `'venue'` добавится вместе с площадками. |
| tournament_id | uuid NULL FK → tournaments | |
| granted_by | uuid NULL FK → users | NULL только у первого владельца, созданного CLI |
| created_at | timestamptz | |

C `(scope_type = 'system') = (tournament_id IS NULL)`; U NULLS NOT DISTINCT `(user_id, role_id, tournament_id)`; IX `(tournament_id)`. Снятие роли — удаление строки с записью в `audit_log` (история назначений — ТЗ §8.10).

### 3.2. Справочники

**`countries`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| iso_alpha2 | char(2) NOT NULL U | C `~ '^[A-Z]{2}$'`. Флаг — локальный файл `flags/<iso_alpha2>.svg`. |
| iso_alpha3 | char(3) NULL U | |
| name | text NOT NULL | Название на языке интерфейса v1. Многоязычность — позже (ТЗ §3.2). |
| archived_at | timestamptz NULL | |

Наполняется миграцией с данными ISO 3166-1. Файлы флагов поставляются локально (ТЗ §6, §8.5). Источник набора флагов и его лицензия выбираются на этапе 4.

**`clubs`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| country_id | uuid NULL FK → countries | |
| city | text NULL | |
| archived_at | timestamptz NULL | |
| created_at, updated_at | | |

U NULLS NOT DISTINCT `(lower(name), country_id)` — через уникальный индекс по выражению.

**`disciplines`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| code | text NOT NULL U | `mma`, `sambo`, … — только идентификатор, без правил |
| name | text NOT NULL | |
| archived_at | timestamptz NULL | |

### 3.3. Спортсмены

**`athletes`** — минимум данных (ТЗ §8.4).
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| first_name, last_name | text NOT NULL | |
| birth_date | date NULL | |
| birth_year | smallint NULL | C `birth_year BETWEEN 1900 AND 2100` |
| country_id | uuid NOT NULL FK → countries | |
| club_id | uuid NULL FK → clubs | |
| archived_at | timestamptz NULL | |
| created_at, updated_at | | |

C `birth_date IS NULL OR birth_year IS NULL OR birth_year = extract(year FROM birth_date)`. IX `(lower(last_name), lower(first_name))`, IX `(country_id)`, IX `(club_id)`.

### 3.4. Турниры

**`tournaments`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| starts_on, ends_on | date NOT NULL | C `ends_on >= starts_on` |
| venue | text NULL | Место проведения |
| status | text NOT NULL | C `IN ('draft','scheduled','active','completed')` |
| archived_at | timestamptz NULL | Архивирование (ТЗ §8.3) — отдельно от статуса |
| created_by | uuid FK → users | |
| created_at, updated_at | | |

IX `(status) WHERE archived_at IS NULL`, IX `(starts_on)`.

**`tournament_disciplines`** — PK `(tournament_id, discipline_id)`. FK на tournaments ON DELETE CASCADE, на disciplines RESTRICT.

**`tournament_rule_versions`** — версии правил, утверждённые организатором для турнира (ТЗ §7.2).
| Колонка | Тип | Примечание |
|---|---|---|
| tournament_id | uuid FK → tournaments | |
| rule_profile_version_id | uuid FK → rule_profile_versions | Триггер: только `status = 'approved'` |
| added_by | uuid FK → users | |
| created_at | timestamptz | |

PK `(tournament_id, rule_profile_version_id)`.

**`categories`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid NOT NULL | |
| discipline_id | uuid NOT NULL | |
| name | text NOT NULL | |
| weight_min_kg, weight_max_kg | numeric(5,2) NULL | Необязательные границы |
| age_min, age_max | smallint NULL | |
| created_at, updated_at | | |

FK `(tournament_id, discipline_id)` → `tournament_disciplines`: категория только в дисциплине турнира. U `(tournament_id, lower(name))`. C `weight_min_kg <= weight_max_kg`, `age_min <= age_max` (если оба заданы).

**`tournament_athletes`** — участие (ТЗ: TournamentAthlete).
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid FK → tournaments | |
| athlete_id | uuid FK → athletes | |
| category_id | uuid NULL FK → categories | Триггер или составной FK: категория того же турнира |
| registration_number | text NULL | |
| status | text NOT NULL | C `IN ('registered','withdrawn','disqualified')` |
| created_at, updated_at | | |

U NULLS NOT DISTINCT `(tournament_id, athlete_id, category_id)`; U `(tournament_id, registration_number)`; IX `(category_id)`.

### 3.5. Правила

**`rule_profiles`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| discipline_id | uuid FK → disciplines | |
| code | text NOT NULL | U `(discipline_id, code)` |
| name | text NOT NULL | |
| archived_at | timestamptz NULL | |
| created_by | uuid FK → users | |
| created_at | timestamptz | |

**`rule_profile_versions`** — неизменяема после утверждения.
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| rule_profile_id | uuid FK → rule_profiles | |
| version_number | integer NOT NULL | U `(rule_profile_id, version_number)` |
| status | text NOT NULL | C `IN ('draft','approved','archived')` |
| is_demo | boolean NOT NULL | Демонстрационная версия (ТЗ §10) |
| engine | text NOT NULL | Ключ обработчика, напр. `generic-points` |
| engine_version | integer NOT NULL | Версия обработчика для воспроизведения |
| definition | jsonb NOT NULL | Параметры правил (схема в contracts) |
| definition_sha256 | bytea NOT NULL | Контроль целостности |
| source_title | text NULL | Название регламента |
| source_edition | text NULL | Редакция/версия документа |
| source_url | text NULL | Ссылка или имя файла |
| source_published_on | date NULL | |
| effective_from | date NULL | Дата вступления в силу |
| change_summary | text NULL | «Просмотр изменений» (ТЗ §8.6) |
| created_by | uuid FK → users | |
| approved_by | uuid NULL FK → users | |
| approved_at | timestamptz NULL | |
| created_at | timestamptz | |

Ограничения:
- C `status = 'draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND effective_from IS NOT NULL)`.
- C `is_demo OR status = 'draft' OR (source_title IS NOT NULL AND source_edition IS NOT NULL)` — неdemo-версию нельзя утвердить без источника.
- Триггер `BEFORE UPDATE`: если `OLD.status <> 'draft'`, разрешено изменить только `status` с `approved` на `archived`. Любое другое изменение → исключение. `DELETE` разрешён только для `draft`.
- IX `(rule_profile_id, status)`.

### 3.6. Поединки

**`matches`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid FK → tournaments | |
| discipline_id | uuid NOT NULL | FK `(tournament_id, discipline_id)` → tournament_disciplines |
| category_id | uuid NULL FK → categories | |
| rule_profile_version_id | uuid NULL | FK `(tournament_id, rule_profile_version_id)` → tournament_rule_versions. NULL допустим только в `prepared`: по сценарию ТЗ §17 профиль выбирается после создания поединка. C `status IN ('prepared','cancelled') OR rule_profile_version_id IS NOT NULL` |
| match_number | integer NOT NULL | U `(tournament_id, match_number)` |
| status | text NOT NULL | C `IN ('prepared','ready','live','awaiting_confirmation','completed','cancelled')` |
| scheduled_at | timestamptz NULL | |
| cancel_reason | text NULL | C `status <> 'cancelled' OR cancel_reason IS NOT NULL` |
| created_by | uuid FK → users | |
| created_at, updated_at | | |

IX `(tournament_id, status)`, IX `(category_id)`, IX `(scheduled_at)`. Фильтр по дисциплине — через `(tournament_id, discipline_id)`. Триггер запрещает менять `rule_profile_version_id`, `tournament_id` и участников после выхода из `prepared`.

**`match_participants`**
| Колонка | Тип | Примечание |
|---|---|---|
| match_id | uuid FK → matches ON DELETE CASCADE | Каскад только пока поединок `prepared` (удаление поединков в других статусах запрещено триггером) |
| side | text NOT NULL | C `IN ('red','blue')` |
| tournament_athlete_id | uuid NOT NULL FK → tournament_athletes | |

PK `(match_id, side)`; U `(match_id, tournament_athlete_id)`.

**`match_officials`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| match_id | uuid FK → matches | |
| user_id | uuid FK → users | |
| official_role | text NOT NULL | C `IN ('chief_judge','judge')`. Список расширяется по регламентам. |
| permissions | text[] NOT NULL DEFAULT '{}' | Коды действий. Итоговые права = это ∩ права роли в профиле. |
| assigned_by | uuid FK → users | |
| created_at | timestamptz | |

U `(match_id, user_id)`; частичный U `(match_id) WHERE official_role = 'chief_judge'` — один главный судья; IX `(user_id)` — «мои поединки». Изменение после `ready` — только с записью в `audit_log`.

**`match_states`** — актуальное состояние, 1:1 с matches. Создаётся вместе с поединком.
| Колонка | Тип | Примечание |
|---|---|---|
| match_id | uuid PK FK → matches | |
| version | bigint NOT NULL DEFAULT 0 | Растёт на 1 с каждым событием |
| period_index | integer NOT NULL DEFAULT 0 | |
| phase | text NULL | Фаза из профиля (перерыв и т. п.) |
| timer_status | text NOT NULL | C `IN ('stopped','running')` |
| timer_remaining_ms | integer NOT NULL | C `>= 0` |
| timer_started_at | timestamptz NULL | C `(timer_status = 'running') = (timer_started_at IS NOT NULL)` |
| score | jsonb NOT NULL | Счётчики по сторонам; ключи из профиля |
| penalties | jsonb NOT NULL | Предупреждения и штрафы по сторонам |
| updated_at | timestamptz NOT NULL | |

Это **проекция** журнала: она должна совпадать со свёрткой `match_events` (проверяется тестом). Блокировка строки `FOR UPDATE` сериализует команды поединка (ARCHITECTURE §6.2).

**`match_events`** — журнал подтверждённых событий, append-only.
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| match_id | uuid FK → matches | |
| seq | bigint NOT NULL | = `match_states.version` после события. U `(match_id, seq)` |
| command_id | uuid NULL | От клиента. U `(match_id, command_id)` — идемпотентность. NULL у системных событий (`timer_expired`). |
| type | text NOT NULL | Тип из движка (`score.add`, `timer.start`, `event.void`, …) |
| payload | jsonb NOT NULL | Параметры команды и вычисленные значения (напр. фактическое оставшееся время) |
| actor_user_id | uuid NULL FK → users | NULL у системных событий |
| actor_role | text NOT NULL | `chief_judge`, `judge`, `system`, … |
| corrects_event_id | uuid NULL FK → match_events | Для исправлений |
| reason | text NULL | C `corrects_event_id IS NULL OR reason IS NOT NULL`. Обязателен у исправлений и корректировок времени. |
| server_time | timestamptz NOT NULL DEFAULT now() | |

IX `(match_id, seq)` покрыт уникальным. Триггер append-only.

**`match_results`** — официальный результат, неизменяем.
| Колонка | Тип | Примечание |
|---|---|---|
| match_id | uuid PK FK → matches | |
| winner_side | text NULL | C `IN ('red','blue')`. NULL — если профиль допускает исход без победителя. |
| outcome_code | text NOT NULL | Способ завершения из профиля |
| final_state | jsonb NOT NULL | Снимок счёта, штрафов, времени |
| participants_snapshot | jsonb NOT NULL | ФИО, страна, клуб на момент поединка — историческая целостность при последующей правке спортсмена |
| rule_profile_version_id | uuid NOT NULL FK | Дублирование ради самодостаточности результата |
| final_event_seq | bigint NOT NULL | Последнее событие журнала |
| confirmed_by | uuid NOT NULL FK → users | |
| confirmed_at | timestamptz NOT NULL | |

Триггер: `UPDATE`/`DELETE` запрещены (ARCHITECTURE §11, вопрос 8).

### 3.7. Табло и аудит

**`displays`**
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid FK → tournaments | |
| name | text NOT NULL | «Татами 1 — ТВ» |
| public_token | text NOT NULL U | Случайные 32 байта, base64url. Только чтение публичной проекции. Можно перевыпустить. |
| current_match_id | uuid NULL FK → matches | Триггер: поединок того же турнира |
| is_active | boolean NOT NULL DEFAULT true | |
| created_by | uuid FK → users | |
| created_at, updated_at | | |

IX `(tournament_id)`. Статус подключения табло (ТЗ §8.2) хранится в памяти Realtime, не в БД: это эфемерное состояние.

**`audit_log`** — append-only.
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | |
| occurred_at | timestamptz NOT NULL DEFAULT now() | |
| actor_user_id | uuid NULL FK → users | NULL — система или CLI |
| action | text NOT NULL | `user.create`, `role.grant`, `official.assign`, `rules.approve`, `auth.login_failed`, … |
| entity_type | text NOT NULL | |
| entity_id | uuid NULL | **Без FK**: запись переживает любую сущность |
| tournament_id | uuid NULL | Для фильтрации и разграничения доступа к журналу |
| data | jsonb NOT NULL | Изменённые поля «до/после» без секретов |
| ip | inet NULL | |
| request_id | uuid NULL | Корреляция с логами |

IX `(occurred_at DESC)`, IX `(entity_type, entity_id)`, IX `(tournament_id, occurred_at DESC)`, IX `(actor_user_id)`.

Запись в `audit_log` выполняется **в той же транзакции**, что и изменение, иначе действие и его аудит могут разойтись.

## 4. Транзакции и конкурентность

| Операция | Транзакция |
|---|---|
| Команда поединка | `match_states FOR UPDATE` → проверки → `INSERT match_events` → `UPDATE match_states` → (результат) → `COMMIT` → рассылка. Уровень `READ COMMITTED` достаточен: строка заблокирована. |
| Создание поединка | `matches` + `match_participants` + `match_states` + `audit_log` — одна транзакция. |
| Утверждение версии правил | `UPDATE status` + `audit_log`. Неизменяемость дальше обеспечивает триггер. |
| Назначение судей и ролей | Изменение + `audit_log` в одной транзакции. |
| Редактирование справочников | Оптимистичная блокировка по `updated_at`: клиент передаёт прочитанное значение, `UPDATE … WHERE updated_at = $old`. 0 строк → `409 CONFLICT`. |

Длинных транзакций нет. Сеть и рассылка — всегда после `COMMIT`.

## 5. Пример DDL (ключевой фрагмент)

```sql
CREATE TABLE match_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid NOT NULL REFERENCES matches(id),
  seq               bigint NOT NULL,
  command_id        uuid,
  type              text NOT NULL,
  payload           jsonb NOT NULL,
  actor_user_id     uuid REFERENCES users(id),
  actor_role        text NOT NULL,
  corrects_event_id uuid REFERENCES match_events(id),
  reason            text,
  server_time       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_events_seq_uq     UNIQUE (match_id, seq),
  CONSTRAINT match_events_command_uq UNIQUE (match_id, command_id),
  CONSTRAINT match_events_reason_ck  CHECK (corrects_event_id IS NULL OR reason IS NOT NULL)
);

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER match_events_append_only
  BEFORE UPDATE OR DELETE ON match_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
```

`UNIQUE (match_id, command_id)` не мешает системным событиям: строки с `command_id IS NULL` не конфликтуют между собой (поведение `NULLS DISTINCT` по умолчанию).

## 6. Миграции

- **Формат:** `backend/migrations/NNNN_краткое_описание.sql`, четырёхзначный номер, только SQL. Миграции только вперёд: исправление — новая миграция. Down-миграций нет, откат = восстановление из резервной копии, сделанной перед миграцией.
- **Раннер:** собственный скрипт `backend/scripts/migrate` (≈100 строк на `pg`):
  1. `pg_advisory_lock` — защита от параллельного запуска;
  2. таблица `schema_migrations (version integer PK, name text, checksum bytea, applied_at timestamptz)`;
  3. каждая новая миграция применяется в своей транзакции вместе с записью в `schema_migrations`;
  4. **контрольная сумма** уже применённых файлов сверяется: изменённый задним числом файл → ошибка и остановка.
- **Права БД:** две роли PostgreSQL. `fightscore_owner` владеет схемой и запускает миграции. `fightscore_app` используется приложением: DML без DDL. У `fightscore_app` нет `UPDATE`/`DELETE` на `match_events`, `audit_log`, `match_results` — это вторая линия защиты рядом с триггерами.
- **Справочные данные** (роли, права, страны) — в миграциях. **Демо-данные** (демо-профили, тестовые турниры) — отдельный скрипт `seed:dev`, который **отказывается запускаться** при `NODE_ENV=production`.
- **Тесты:** интеграционные тесты поднимают отдельную БД `fightscore_test`, применяют все миграции с нуля и проверяют ограничения (append-only, неизменяемость версий, уникальности). Docker и testcontainers не используются: тестовая БД — на локальном PostgreSQL.
- **Процедура в production:** резервная копия → `migrate` → запуск приложения. Приложение при старте проверяет, что все миграции применены, иначе не стартует.
