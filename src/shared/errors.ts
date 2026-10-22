/** Errors a service raises on purpose. The message is safe to show to the user. */
export type AppErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'ARCHIVED';

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    /** Field-level messages keyed by field name, for forms. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
