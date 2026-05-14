// Fastify plugin: decodes the Authorization bearer token, looks up the
// session row, and populates req.auth.  Routes that need authentication
// add `preHandler: [requireAuth]`; public routes (e.g. /auth/login) do
// not.

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';

import type { BackendConfig } from '../config.js';
import { UnauthorizedError } from '../lib/errors.js';
import { verifyAccessToken } from './jwt.js';

export interface RequestAuth {
  readonly userId: string;
  readonly sessionId: string;
  readonly facilityId: string | null;
  readonly roles: readonly string[];
  // Set true by the break-glass route after writing a row.  Defaults to
  // false; cannot be set by the client.
  readonly breakGlass: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: RequestAuth;
  }
}

interface AuthPluginOptions {
  readonly config: BackendConfig;
}

const authPluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (
  app: FastifyInstance,
  options,
) => {
  app.decorateRequest('auth', null);

  // Routes opt in via preHandler: [requireAuth].
  app.decorate(
    'requireAuth',
    async (req: FastifyRequest, _reply: FastifyReply) => {
      const header = req.headers.authorization;
      if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
        throw new UnauthorizedError('Missing bearer token');
      }
      const token = header.slice('Bearer '.length).trim();
      let claims;
      try {
        claims = await verifyAccessToken(options.config, token);
      } catch {
        throw new UnauthorizedError('Invalid or expired token');
      }
      req.auth = {
        userId: claims.sub,
        sessionId: claims.sid,
        facilityId: claims.fid,
        roles: claims.roles,
        breakGlass: false,
      };
    },
  );
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin',
});

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
