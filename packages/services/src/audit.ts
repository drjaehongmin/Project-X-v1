// In-memory audit store and the scoped-service factory the shell uses
// to hand each module its own AuditService instance.
//
// The store is the authoritative log; the scoped service is a thin
// adapter that pre-binds `id`, `timestamp`, `user`, and `module` before
// pushing into the store. Modules cannot spoof another user or
// misattribute to another module because they never get the unscoped
// store — only the shell does.

import type {
  AuditEntry,
  AuditEntryId,
  AuditFilter,
  AuditLogInput,
  AuditService,
  ModuleId,
  UserId,
} from '@emr/contracts';

export interface AuditStore {
  // Wide log: caller supplies a fully formed entry. The shell uses this
  // for shell-originated events (e.g. session-establishment); modules
  // never see it.
  log(entry: AuditEntry): void;
  list(filter?: AuditFilter): readonly AuditEntry[];
  subscribe(listener: (entry: AuditEntry) => void): () => void;
  clear(): void;
}

export function createAuditStore(): AuditStore {
  const entries: AuditEntry[] = [];
  const listeners = new Set<(entry: AuditEntry) => void>();

  return {
    log(entry) {
      entries.push(entry);
      for (const listener of listeners) listener(entry);
    },
    list(filter) {
      if (filter === undefined) return entries.slice();
      return entries.filter((e) => matchesFilter(e, filter));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      entries.length = 0;
    },
  };
}

export interface AuditScope {
  readonly moduleId: ModuleId;
  readonly userId: UserId;
}

export function createScopedAuditService(
  store: AuditStore,
  scope: AuditScope,
): AuditService {
  return {
    log(input: AuditLogInput): AuditEntry {
      const entry: AuditEntry = {
        id: generateAuditEntryId(),
        timestamp: new Date().toISOString(),
        user: scope.userId,
        module: scope.moduleId,
        action: input.action,
        resource: input.resource,
        // exactOptionalPropertyTypes is on; only spread optional fields
        // when actually present so the resulting entry's `in` checks
        // match the contract.
        ...(input.patient !== undefined && { patient: input.patient }),
        ...(input.before !== undefined && { before: input.before }),
        ...(input.after !== undefined && { after: input.after }),
        ...(input.reason !== undefined && { reason: input.reason }),
      };
      store.log(entry);
      return entry;
    },
    list(filter) {
      return store.list(filter);
    },
    subscribe(listener) {
      return store.subscribe(listener);
    },
  };
}

function matchesFilter(entry: AuditEntry, filter: AuditFilter): boolean {
  if (filter.user !== undefined && entry.user !== filter.user) return false;
  if (filter.module !== undefined && entry.module !== filter.module) return false;
  if (filter.patient !== undefined && entry.patient !== filter.patient) return false;
  // ISO 8601 timestamps are lexicographically comparable.
  if (filter.since !== undefined && entry.timestamp < filter.since) return false;
  if (filter.until !== undefined && entry.timestamp > filter.until) return false;
  return true;
}

let auditEntryCounter = 0;

function generateAuditEntryId(): AuditEntryId {
  auditEntryCounter += 1;
  return `audit-${Date.now()}-${auditEntryCounter}` as AuditEntryId;
}
