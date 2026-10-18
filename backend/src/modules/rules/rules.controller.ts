import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { isoDate, parse, uuid } from '../../common/validation.js';
import { DatabaseService, type Db } from '../../database/database.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClientIp, CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { definitionSchema, type RuleDefinition } from './definition.js';

const ENGINE = 'generic-points';
const ENGINE_VERSION = 1;

/** Without these a match can neither start nor finish (engine.ts maps commands to these actions). */
const REQUIRED_CHIEF_ACTIONS = ['timer', 'end', 'confirm'] as const;

const runnableDefinition = definitionSchema.superRefine((d, ctx) => {
  const missing = REQUIRED_CHIEF_ACTIONS.filter((a) => !d.roles.chief_judge.includes(a));
  if (missing.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['roles', 'chief_judge'],
      message: 'Главному судье нужны таймер, завершение и подтверждение результата — иначе поединок нельзя провести',
    });
  }
});

const sourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  edition: z.string().trim().min(1).max(100),
  url: z.union([z.string().trim().url().max(500), z.literal('')]).nullish(),
  publishedOn: isoDate.nullish(),
});

const versionInput = z.object({
  official: z.boolean().default(false),
  definition: runnableDefinition,
  changeSummary: z.string().trim().max(500).nullish(),
  source: sourceSchema.nullish(),
  effectiveFrom: isoDate.nullish(),
});

const profileMeta = z.object({
  name: z.string().trim().min(3, 'Название не короче 3 символов').max(120),
  description: z.string().trim().max(1000).nullish(),
});

const createSchema = profileMeta.extend({ disciplineId: uuid }).and(versionInput);
const newVersionSchema = z.object({ fromVersionId: uuid.nullish() });
const duplicateSchema = z.object({ versionId: uuid.nullish(), name: z.string().trim().min(3).max(120).nullish() });

interface Abilities {
  manageAll: boolean;
  create: boolean;
  approveOfficial: boolean;
}

interface ProfileRow {
  id: string;
  created_by: string | null;
  visibility: 'shared' | 'private';
  archived_at: string | null;
  name: string;
  discipline_id: string;
}

/** Rows that INSERT ... RETURNING or an aggregate always produce. */
function must<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('expected a row');
  return row;
}

const sha256 = (definition: RuleDefinition) => createHash('sha256').update(JSON.stringify(definition)).digest();

/**
 * Rule profiles and their versions (PROJECT_SPEC §8.6, §10).
 * A match binds one immutable approved version; editing changes only drafts, and a new edition is a new version.
 */
@Controller()
export class RulesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private async abilities(userId: string, db?: Db): Promise<Abilities> {
    const grants = await this.access.grants(userId, db);
    const has = (p: string) => grants.some((g) => g.scope_type === 'system' && g.permission === p);
    const manageAll = has('rules.manage');
    return { manageAll, create: manageAll || has('rules.create'), approveOfficial: has('rules.approve') };
  }

  private canEdit(p: ProfileRow, userId: string, a: Abilities) {
    return a.manageAll || (a.create && p.created_by === userId);
  }

  private visible(p: ProfileRow, userId: string, a: Abilities) {
    return p.visibility === 'shared' || p.created_by === userId || a.manageAll;
  }

  /** Loads a profile the user may see, optionally requiring edit rights. */
  private async profile(id: string, user: SessionUser, needEdit: boolean, db?: Db) {
    const a = await this.abilities(user.id, db);
    const p = await this.db.one<ProfileRow>(
      `SELECT id, created_by, visibility, archived_at, name, discipline_id FROM rule_profiles WHERE id = $1`,
      [parse(uuid, id)],
      db,
    );
    if (!p || !this.visible(p, user.id, a)) throw new AppError('NOT_FOUND', 'Профиль правил не найден');
    if (needEdit && !this.canEdit(p, user.id, a)) throw new AppError('FORBIDDEN', 'Недостаточно прав для изменения этого профиля', { permission: 'rules.manage' });
    return { p, a };
  }

  private async version(id: string, user: SessionUser, needEdit: boolean, db?: Db) {
    const v = await this.db.one<{ id: string; rule_profile_id: string; status: string; is_demo: boolean; version_number: number }>(
      `SELECT id, rule_profile_id, status, is_demo, version_number FROM rule_profile_versions WHERE id = $1`,
      [parse(uuid, id)],
      db,
    );
    if (!v) throw new AppError('NOT_FOUND', 'Версия правил не найдена');
    const { p, a } = await this.profile(v.rule_profile_id, user, needEdit, db);
    return { v, p, a };
  }

  private checkOfficial(official: boolean, a: Abilities) {
    if (official && !a.manageAll) {
      throw new AppError('FORBIDDEN', 'Официальный регламент может заводить только организатор системы или владелец', { permission: 'rules.manage' });
    }
  }

  @Get('rule-profiles')
  async list(@CurrentUser() user: SessionUser) {
    const a = await this.abilities(user.id);
    const profiles = await this.db.query(
      `SELECT p.id, p.name, p.description, p.visibility, p.archived_at, p.created_at, p.created_by,
              d.id AS discipline_id, d.name AS discipline_name, u.display_name AS author_name,
              coalesce(json_agg(json_build_object(
                'id', v.id, 'version_number', v.version_number, 'status', v.status, 'is_demo', v.is_demo,
                'effective_from', v.effective_from, 'source_title', v.source_title, 'source_edition', v.source_edition
              ) ORDER BY v.version_number DESC) FILTER (WHERE v.id IS NOT NULL), '[]') AS versions,
              (SELECT count(*) FROM matches m JOIN rule_profile_versions mv ON mv.id = m.rule_profile_version_id
                WHERE mv.rule_profile_id = p.id)::int AS matches_count
         FROM rule_profiles p
         JOIN disciplines d ON d.id = p.discipline_id
         LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN rule_profile_versions v ON v.rule_profile_id = p.id
        WHERE p.visibility = 'shared' OR p.created_by = $1 OR $2
        GROUP BY p.id, d.id, u.display_name
        ORDER BY p.archived_at NULLS FIRST, d.name, p.name`,
      [user.id, a.manageAll],
    );
    return {
      abilities: a,
      profiles: profiles.map((p) => ({ ...p, can_edit: this.canEdit(p as unknown as ProfileRow, user.id, a) })),
    };
  }

  @Get('rule-profiles/:id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const { p, a } = await this.profile(id, user, false);
    const [profile, versions] = await Promise.all([
      this.db.one(
        `SELECT p.id, p.name, p.description, p.visibility, p.archived_at, p.created_at, d.id AS discipline_id, d.name AS discipline_name,
                u.display_name AS author_name
           FROM rule_profiles p JOIN disciplines d ON d.id = p.discipline_id LEFT JOIN users u ON u.id = p.created_by
          WHERE p.id = $1`,
        [p.id],
      ),
      this.db.query(
        `SELECT v.id, v.version_number, v.status, v.is_demo, v.engine, v.engine_version, v.definition, v.source_title, v.source_edition,
                v.source_url, v.source_published_on, v.effective_from, v.change_summary, v.created_at, v.approved_at,
                cu.display_name AS created_by_name, au.display_name AS approved_by_name,
                (SELECT count(*) FROM matches m WHERE m.rule_profile_version_id = v.id)::int AS matches_count
           FROM rule_profile_versions v
           LEFT JOIN users cu ON cu.id = v.created_by
           LEFT JOIN users au ON au.id = v.approved_by
          WHERE v.rule_profile_id = $1
          ORDER BY v.version_number DESC`,
        [p.id],
      ),
    ]);
    return { ...profile, versions, can_edit: this.canEdit(p, user.id, a), abilities: a };
  }

  @Post('rule-profiles')
  async create(@CurrentUser() user: SessionUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    const a = await this.abilities(user.id);
    if (!a.create) throw new AppError('FORBIDDEN', 'Недостаточно прав для создания профиля правил', { permission: 'rules.create' });
    const input = parse(createSchema, body);
    this.checkOfficial(input.official, a);
    return this.db.tx(async (c) => {
      const profile = must(await this.db.one<{ id: string }>(
        `INSERT INTO rule_profiles (discipline_id, code, name, description, visibility, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.disciplineId, `custom-${randomBytes(5).toString('hex')}`, input.name, input.description || null, a.manageAll ? 'shared' : 'private', user.id],
        c,
      ));
      const version = await this.insertVersion(c, profile.id, 1, input, user.id);
      await this.audit.record(
        { actorUserId: user.id, action: 'rules.profile_create', entityType: 'rule_profile', entityId: profile.id, data: { name: input.name, official: input.official }, ip },
        c,
      );
      return { id: profile.id, versionId: version.id };
    });
  }

  private async insertVersion(c: Db, profileId: string, number: number, input: z.infer<typeof versionInput>, userId: string) {
    return must(await this.db.one<{ id: string }>(
      `INSERT INTO rule_profile_versions (rule_profile_id, version_number, status, is_demo, engine, engine_version, definition,
         definition_sha256, source_title, source_edition, source_url, source_published_on, effective_from, change_summary, created_by)
       VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [
        profileId,
        number,
        !input.official,
        ENGINE,
        ENGINE_VERSION,
        JSON.stringify(input.definition),
        sha256(input.definition),
        input.source?.title ?? null,
        input.source?.edition ?? null,
        input.source?.url || null,
        input.source?.publishedOn ?? null,
        input.effectiveFrom ?? null,
        input.changeSummary || null,
        userId,
      ],
      c,
    ));
  }

  @Put('rule-profiles/:id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { p } = await this.profile(id, user, true);
    const input = parse(profileMeta, body);
    await this.db.tx(async (c) => {
      await this.db.query(`UPDATE rule_profiles SET name = $2, description = $3 WHERE id = $1`, [p.id, input.name, input.description || null], c);
      await this.audit.record({ actorUserId: user.id, action: 'rules.profile_update', entityType: 'rule_profile', entityId: p.id, data: input, ip }, c);
    });
    return { ok: true };
  }

  @Post('rule-profiles/:id/archive')
  archive(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    return this.setArchived(user, id, true, ip);
  }

  @Post('rule-profiles/:id/restore')
  restore(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    return this.setArchived(user, id, false, ip);
  }

  private async setArchived(user: SessionUser, id: string, archived: boolean, ip: string | null) {
    const { p } = await this.profile(id, user, true);
    await this.db.tx(async (c) => {
      await this.db.query(`UPDATE rule_profiles SET archived_at = ${archived ? 'coalesce(archived_at, now())' : 'NULL'} WHERE id = $1`, [p.id], c);
      await this.audit.record(
        { actorUserId: user.id, action: archived ? 'rules.profile_archive' : 'rules.profile_restore', entityType: 'rule_profile', entityId: p.id, ip },
        c,
      );
    });
    return { ok: true };
  }

  /** New draft edition copied from an existing version (the latest one by default). One draft per profile at a time. */
  @Post('rule-profiles/:id/versions')
  async newVersion(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { p } = await this.profile(id, user, true);
    if (p.archived_at) throw new AppError('CONFLICT', 'Профиль в архиве. Верните его из архива, чтобы создать новую версию');
    const { fromVersionId } = parse(newVersionSchema, body ?? {});
    return this.db.tx(async (c) => {
      const draft = await this.db.one(`SELECT version_number FROM rule_profile_versions WHERE rule_profile_id = $1 AND status = 'draft'`, [p.id], c);
      if (draft) throw new AppError('CONFLICT', `У профиля уже есть черновик версии ${draft.version_number}. Измените или удалите его`);
      const src = await this.db.one(
        `SELECT * FROM rule_profile_versions WHERE rule_profile_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY version_number DESC LIMIT 1`,
        [p.id, fromVersionId ?? null],
        c,
      );
      if (!src) throw new AppError('NOT_FOUND', 'Исходная версия не найдена');
      const next = must(await this.db.one<{ n: number }>(`SELECT max(version_number) + 1 AS n FROM rule_profile_versions WHERE rule_profile_id = $1`, [p.id], c));
      const row = must(await this.db.one<{ id: string }>(
        `INSERT INTO rule_profile_versions (rule_profile_id, version_number, status, is_demo, engine, engine_version, definition,
           definition_sha256, source_title, source_edition, source_url, source_published_on, change_summary, created_by)
         SELECT rule_profile_id, $2, 'draft', is_demo, engine, engine_version, definition, definition_sha256,
                source_title, source_edition, source_url, source_published_on, NULL, $3
           FROM rule_profile_versions WHERE id = $1 RETURNING id`,
        [src.id, next.n, user.id],
        c,
      ));
      await this.audit.record(
        { actorUserId: user.id, action: 'rules.version_create', entityType: 'rule_profile_version', entityId: row.id, data: { profileId: p.id, from: src.version_number }, ip },
        c,
      );
      return { id: row.id, versionNumber: next.n };
    });
  }

  @Put('rule-versions/:id')
  async updateDraft(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { v, a } = await this.version(id, user, true);
    if (v.status !== 'draft') throw new AppError('CONFLICT', 'Утверждённая версия неизменяема. Создайте новую версию на её основе');
    const input = parse(versionInput, body);
    this.checkOfficial(input.official, a);
    await this.db.tx(async (c) => {
      await this.db.query(
        `UPDATE rule_profile_versions
            SET is_demo = $2, definition = $3, definition_sha256 = $4, source_title = $5, source_edition = $6, source_url = $7,
                source_published_on = $8, effective_from = $9, change_summary = $10
          WHERE id = $1 AND status = 'draft'`,
        [
          v.id,
          !input.official,
          JSON.stringify(input.definition),
          sha256(input.definition),
          input.source?.title ?? null,
          input.source?.edition ?? null,
          input.source?.url || null,
          input.source?.publishedOn ?? null,
          input.effectiveFrom ?? null,
          input.changeSummary || null,
        ],
        c,
      );
      await this.audit.record({ actorUserId: user.id, action: 'rules.version_update', entityType: 'rule_profile_version', entityId: v.id, ip }, c);
    });
    return { ok: true };
  }

  /**
   * Draft -> approved. A non-official (demo/custom) version is published by whoever may edit the profile;
   * an official regulation needs a source and the rules.approve permission (PROJECT_SPEC §10).
   */
  @Post('rule-versions/:id/publish')
  async publish(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    const { v, p, a } = await this.version(id, user, true);
    if (v.status !== 'draft') throw new AppError('CONFLICT', 'Опубликовать можно только черновик');
    if (p.archived_at) throw new AppError('CONFLICT', 'Профиль в архиве. Верните его из архива, чтобы опубликовать версию');
    if (!v.is_demo && !a.approveOfficial) {
      throw new AppError('FORBIDDEN', 'Утвердить официальный регламент может только владелец системы', { permission: 'rules.approve' });
    }
    await this.db.tx(async (c) => {
      const full = await this.db.one(`SELECT source_title, source_edition FROM rule_profile_versions WHERE id = $1`, [v.id], c);
      if (!v.is_demo && (!full.source_title || !full.source_edition)) {
        throw new AppError('VALIDATION', 'Для официального регламента укажите источник и редакцию документа');
      }
      await this.db.query(
        `UPDATE rule_profile_versions
            SET status = 'approved', approved_by = $2, approved_at = now(), effective_from = coalesce(effective_from, current_date)
          WHERE id = $1 AND status = 'draft'`,
        [v.id, user.id],
        c,
      );
      await this.audit.record(
        { actorUserId: user.id, action: 'rules.version_publish', entityType: 'rule_profile_version', entityId: v.id, data: { official: !v.is_demo, version: v.version_number }, ip },
        c,
      );
    });
    return { ok: true };
  }

  /** Approved -> archived: no new matches can use it; matches that already use it keep it. */
  @Post('rule-versions/:id/archive')
  async archiveVersion(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    const { v } = await this.version(id, user, true);
    if (v.status !== 'approved') throw new AppError('CONFLICT', 'В архив можно отправить только утверждённую версию');
    await this.db.tx(async (c) => {
      await this.db.query(`UPDATE rule_profile_versions SET status = 'archived' WHERE id = $1 AND status = 'approved'`, [v.id], c);
      await this.audit.record({ actorUserId: user.id, action: 'rules.version_archive', entityType: 'rule_profile_version', entityId: v.id, ip }, c);
    });
    return { ok: true };
  }

  @Delete('rule-versions/:id')
  async deleteDraft(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    const { v, p } = await this.version(id, user, true);
    if (v.status !== 'draft') throw new AppError('CONFLICT', 'Удалить можно только черновик; утверждённые версии сохраняются навсегда');
    await this.db.tx(async (c) => {
      const others = must(await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM rule_profile_versions WHERE rule_profile_id = $1 AND id <> $2`, [p.id, v.id], c));
      if (others.n === 0) throw new AppError('CONFLICT', 'Это единственная версия профиля. Отправьте профиль в архив вместо удаления');
      await this.db.query(`DELETE FROM rule_profile_versions WHERE id = $1 AND status = 'draft'`, [v.id], c);
      await this.audit.record({ actorUserId: user.id, action: 'rules.version_delete', entityType: 'rule_profile_version', entityId: v.id, data: { profileId: p.id }, ip }, c);
    });
    return { ok: true };
  }

  /** A copy is always a new non-official draft: it is the user's own edit, not the source regulation. */
  @Post('rule-profiles/:id/duplicate')
  async duplicate(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { p, a } = await this.profile(id, user, false);
    if (!a.create) throw new AppError('FORBIDDEN', 'Недостаточно прав для создания профиля правил', { permission: 'rules.create' });
    const input = parse(duplicateSchema, body ?? {});
    return this.db.tx(async (c) => {
      const src = await this.db.one<{ definition: RuleDefinition; version_number: number }>(
        `SELECT definition, version_number FROM rule_profile_versions WHERE rule_profile_id = $1 AND ($2::uuid IS NULL OR id = $2)
          ORDER BY (status = 'approved') DESC, version_number DESC LIMIT 1`,
        [p.id, input.versionId ?? null],
        c,
      );
      if (!src) throw new AppError('NOT_FOUND', 'Исходная версия не найдена');
      const meta = must(await this.db.one<{ description: string | null }>(`SELECT description FROM rule_profiles WHERE id = $1`, [p.id], c));
      const name = input.name || `Копия: ${p.name}`.slice(0, 120);
      const profile = must(await this.db.one<{ id: string }>(
        `INSERT INTO rule_profiles (discipline_id, code, name, description, visibility, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [p.discipline_id, `custom-${randomBytes(5).toString('hex')}`, name, meta.description, a.manageAll ? 'shared' : 'private', user.id],
        c,
      ));
      const version = await this.insertVersion(
        c,
        profile.id,
        1,
        { official: false, definition: src.definition, changeSummary: `Копия профиля «${p.name}», версия ${src.version_number}` },
        user.id,
      );
      await this.audit.record(
        { actorUserId: user.id, action: 'rules.profile_duplicate', entityType: 'rule_profile', entityId: profile.id, data: { from: p.id, version: src.version_number }, ip },
        c,
      );
      return { id: profile.id, versionId: version.id };
    });
  }
}
