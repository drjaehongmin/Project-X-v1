// Fastify preHandler factory.  Used as:
//
//   app.get('/patients/:id', {
//     preHandler: [app.requireAuth, requirePermission('patient.read')],
//   }, handler);
//
// requireAuth populates req.auth; requirePermission then asserts the
// effective permission set.  Patient-row access is enforced by RLS on
// top of this.

import type { FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { hasPermission } from './compute.js';
import type { Permission } from './catalog.js';

export function requirePermission(needed: Permission) {
  return async function preHandler(
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    if (req.auth === undefined) {
      throw new UnauthorizedError();
    }
    if (!hasPermission(req.auth.roles, needed)) {
      throw new ForbiddenError(`Missing permission: ${needed}`);
    }
  };
}
