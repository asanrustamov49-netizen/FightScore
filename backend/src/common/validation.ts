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

/** Login for new accounts. An e-mail address is accepted too, since people usually type one. */
export const LOGIN_HINT = 'Латиница, цифры и символы . _ - @ + (подойдёт e-mail)';
export const login = z.string().trim().min(3, 'Логин не короче 3 символов').max(60).regex(/^[a-zA-Z0-9._@+-]+$/, LOGIN_HINT);
