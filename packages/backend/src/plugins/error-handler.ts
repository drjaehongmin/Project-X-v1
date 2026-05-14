// Maps thrown errors to JSON responses.  AppError subclasses carry
// their own status code; everything else becomes a 500 with a generic
// message (the original error is logged).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../lib/errors.js';

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
    readonly requestId?: string;
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: Error, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      const body: ErrorBody = {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined && { details: err.details }),
          ...(req.id !== undefined && { requestId: String(req.id) }),
        },
      };
      void reply.code(err.statusCode).send(body);
      return;
    }

    // Fastify validation errors carry a `validation` array.
    const validation = (err as { validation?: unknown }).validation;
    if (Array.isArray(validation)) {
      void reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: err.message,
          details: { validation },
          ...(req.id !== undefined && { requestId: String(req.id) }),
        },
      } satisfies ErrorBody);
      return;
    }

    req.log.error({ err }, 'unhandled error');
    void reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'Internal server error',
        ...(req.id !== undefined && { requestId: String(req.id) }),
      },
    } satisfies ErrorBody);
  });
}
