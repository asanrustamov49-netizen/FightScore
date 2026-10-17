import { z } from 'zod';
import { AppError } from './errors.js';

/** Parses `input` with `schema` or throws a VALIDATION error listing the failing fields. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new AppError(
      'VALIDATION',
      'Проверьте введённые данные',
      res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return res.data;
}

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата YYYY-MM-DD');
export const trimmed = (max = 200) => z.string().trim().min(1).max(max);
