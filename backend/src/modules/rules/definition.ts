import { z } from 'zod';

/**
 * Parameters of the `generic-points@1` engine. A rule profile version stores these values;
 * none of them are hard-coded in the engine (PROJECT_SPEC §10).
 */
export const OFFICIAL_ACTIONS = ['score', 'penalty', 'timer', 'period', 'correct', 'end', 'confirm'] as const;
export type OfficialAction = (typeof OFFICIAL_ACTIONS)[number];

const code = z.string().regex(/^[a-z0-9_]{1,40}$/);

export const definitionSchema = z
  .object({
    periods: z.object({ count: z.number().int().min(1).max(20), durationSec: z.number().int().min(1).max(3600) }),
    scoring: z.array(z.object({ code, label: z.string().min(1).max(40), points: z.number().int().min(1).max(100) })).min(1),
    penalties: z.array(
      z.object({
        code,
        label: z.string().min(1).max(60),
        public: z.boolean(),
        opponentPoints: z.number().int().min(0).max(100),
      }),
    ),
    endMethods: z.array(z.object({ code, label: z.string().min(1).max(60), requiresWinner: z.boolean() })).min(1),
    roles: z.object({
      chief_judge: z.array(z.enum(OFFICIAL_ACTIONS)),
      judge: z.array(z.enum(OFFICIAL_ACTIONS)),
    }),
    timeAdjust: z.object({ maxSec: z.number().int().min(0).max(3600) }),
  })
  .superRefine((d, ctx) => {
    for (const [name, list] of [
      ['scoring', d.scoring],
      ['penalties', d.penalties],
      ['endMethods', d.endMethods],
    ] as const) {
      const codes = list.map((x) => x.code);
      if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', message: `Повторяющиеся коды в ${name}`, path: [name] });
    }
  });

export type RuleDefinition = z.infer<typeof definitionSchema>;

/**
 * Disqualification is available in every profile, even one that does not list it: a referee must always be able to
 * stop a match for a fatal foul. A profile's own disqualification method (code "dq" or a label that says so) is used
 * as is; the stored, immutable definition is never changed, the method is only added when the definition is loaded.
 */
export const BUILTIN_DQ = { code: 'dq', label: 'Дисквалификация соперника', requiresWinner: true } as const;

export function isDisqualification(m: { code: string; label: string; requiresWinner: boolean }) {
  return m.requiresWinner && (m.code === BUILTIN_DQ.code || /дисквал/i.test(m.label));
}

export function withDisqualification(def: RuleDefinition): RuleDefinition {
  if (def.endMethods.some(isDisqualification) || def.endMethods.some((m) => m.code === BUILTIN_DQ.code)) return def;
  return { ...def, endMethods: [...def.endMethods, { ...BUILTIN_DQ }] };
}
