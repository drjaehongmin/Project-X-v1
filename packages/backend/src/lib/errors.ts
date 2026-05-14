// Application-level error types.  The Fastify error handler in
// plugins/error-handler.ts knows how to serialize each of these.

export class AppError extends Error {
  override readonly name: string = 'AppError';
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class NotFoundError extends AppError {
  override readonly name = 'NotFoundError';
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'not_found');
  }
}

export class UnauthorizedError extends AppError {
  override readonly name = 'UnauthorizedError';
  constructor(message = 'Authentication required') {
    super(message, 401, 'unauthorized');
  }
}

export class ForbiddenError extends AppError {
  override readonly name = 'ForbiddenError';
  constructor(message = 'Forbidden') {
    super(message, 403, 'forbidden');
  }
}

export class ValidationError extends AppError {
  override readonly name = 'ValidationError';
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'invalid_request', details);
  }
}

export class ConflictError extends AppError {
  override readonly name = 'ConflictError';
  constructor(message: string) {
    super(message, 409, 'conflict');
  }
}
