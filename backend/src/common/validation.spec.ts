import { fromPgError } from './errors.js';
import { login } from './validation.js';

describe('login', () => {
  it('accepts plain logins and e-mail addresses', () => {
    for (const ok of ['ivan', 'demo.organizer', 'judge_2', 'ivan@mail.ru', 'first.last+cup@example.com']) {
      expect(login.safeParse(ok).success, ok).toBe(true);
    }
  });

  it('rejects short, Cyrillic, spaced and other unsafe logins', () => {
    for (const bad of ['iv', 'иван', 'ivan petrov', 'ivan;drop', '<script>', 'a'.repeat(61)]) {
      expect(login.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('fromPgError', () => {
  it('reports a taken login in plain words', () => {
    const err = fromPgError({ code: '23505', constraint: 'users_login_uq' });
    expect(err?.code).toBe('CONFLICT');
    expect(err?.message).toMatch(/логин уже занят/);
  });

  it('keeps the generic message for other unique constraints', () => {
    expect(fromPgError({ code: '23505', constraint: 'other_uq' })?.message).toBe('Запись с такими данными уже существует');
  });
});
