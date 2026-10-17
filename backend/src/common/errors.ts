import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'RULE_VIOLATION'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'CSRF';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  RULE_VIOLATION: 422,
  INVALID_TRANSITION: 422,
  RATE_LIMITED: 429,
  CSRF: 403,
};

/** Domain error with a stable code; serialized as `{ code, message, details? }`. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}

/** Maps Postgres constraint errors to API errors so clients get a 409/400 instead of 500. */
export function fromPgError(err: unknown): AppError | undefined {
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e?.code === '23505') return new AppError('CONFLICT', 'Запись с такими данными уже существует', { constraint: e.constraint });
  if (e?.code === '23503') return new AppError('VALIDATION', 'Ссылка на несуществующую или используемую запись', { constraint: e.constraint });
  if (e?.code === '23514') return new AppError('VALIDATION', 'Данные нарушают ограничение', { constraint: e.constraint });
  if (e?.code === '22P02') return new AppError('VALIDATION', 'Неверный формат идентификатора');
  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const appErr = exception instanceof AppError ? exception : fromPgError(exception);
    if (appErr) {
      res.status(appErr.status).json(appErr.toJSON());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json({ code: status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR', message: exception.message });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 'INTERNAL', message: 'Внутренняя ошибка сервера' });
  }
}
