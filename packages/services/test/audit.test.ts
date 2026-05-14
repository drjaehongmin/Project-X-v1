import { describe, expect, it, vi } from 'vitest';
import type { ModuleId, PatientId, UserId } from '@emr/contracts';
import {
  createAuditStore,
  createScopedAuditService,
} from '../src/audit';

const moduleId = 'test-module' as ModuleId;
const otherModuleId = 'other-module' as ModuleId;
const userId = 'user-1' as UserId;
const otherUserId = 'user-2' as UserId;
const patientId = 'patient-1' as PatientId;

describe('createScopedAuditService', () => {
  it('binds id, timestamp, user, module, and forwards required fields', () => {
    const store = createAuditStore();
    const audit = createScopedAuditService(store, { moduleId, userId });
    const entry = audit.log({ action: 'view', resource: 'Patient/123' });

    expect(entry.id).toMatch(/^audit-/);
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.user).toBe(userId);
    expect(entry.module).toBe(moduleId);
    expect(entry.action).toBe('view');
    expect(entry.resource).toBe('Patient/123');
  });

  it('includes optional fields when supplied', () => {
    const store = createAuditStore();
    const audit = createScopedAuditService(store, { moduleId, userId });
    const entry = audit.log({
      action: 'update',
      resource: 'Patient/123',
      patient: patientId,
      before: { name: 'old' },
      after: { name: 'new' },
      reason: 'correction',
    });
    expect(entry.patient).toBe(patientId);
    expect(entry.before).toEqual({ name: 'old' });
    expect(entry.after).toEqual({ name: 'new' });
    expect(entry.reason).toBe('correction');
  });

  it('omits optional fields when not supplied (exactOptionalPropertyTypes)', () => {
    const store = createAuditStore();
    const audit = createScopedAuditService(store, { moduleId, userId });
    const entry = audit.log({ action: 'view', resource: 'Patient/123' });
    expect('patient' in entry).toBe(false);
    expect('before' in entry).toBe(false);
    expect('after' in entry).toBe(false);
    expect('reason' in entry).toBe(false);
  });

  it('ignores caller attempts to override pre-bound identity fields', () => {
    const store = createAuditStore();
    const audit = createScopedAuditService(store, { moduleId, userId });
    // AuditLogInput's type doesn't include user/module/id/timestamp, so
    // a malicious cast is required to attempt the override. The scoped
    // service must still bind correctly.
    const entry = audit.log({
      action: 'view',
      resource: 'r',
      // @ts-expect-error — confirming runtime ignores stray fields.
      user: otherUserId,
      // @ts-expect-error — confirming runtime ignores stray fields.
      module: otherModuleId,
    });
    expect(entry.user).toBe(userId);
    expect(entry.module).toBe(moduleId);
  });
});

describe('AuditStore', () => {
  it('list() returns entries in insertion order', () => {
    const store = createAuditStore();
    const audit = createScopedAuditService(store, { moduleId, userId });
    audit.log({ action: 'view', resource: 'a' });
    audit.log({ action: 'view', resource: 'b' });
    audit.log({ action: 'view', resource: 'c' });
    expect(store.list().map((e) => e.resource)).toEqual(['a', 'b', 'c']);
  });

  it('filters by module, user, and patient', () => {
    const store = createAuditStore();
    const a = createScopedAuditService(store, { moduleId, userId });
    const b = createScopedAuditService(store, {
      moduleId: otherModuleId,
      userId: otherUserId,
    });
    a.log({ action: 'view', resource: 'r1' });
    a.log({ action: 'view', resource: 'r2', patient: patientId });
    b.log({ action: 'view', resource: 'r3' });

    expect(store.list({ module: moduleId }).map((e) => e.resource)).toEqual([
      'r1',
      'r2',
    ]);
    expect(store.list({ user: otherUserId }).map((e) => e.resource)).toEqual([
      'r3',
    ]);
    expect(store.list({ patient: patientId }).map((e) => e.resource)).toEqual([
      'r2',
    ]);
  });

  it('filters by since/until time bounds (ISO 8601 lexicographic)', () => {
    const store = createAuditStore();
    const audit = createScopedAuditService(store, { moduleId, userId });
    const first = audit.log({ action: 'view', resource: 'a' });
    const second = audit.log({ action: 'view', resource: 'b' });

    // since == first.timestamp ⇒ both visible.
    expect(
      store.list({ since: first.timestamp }).map((e) => e.resource),
    ).toEqual(['a', 'b']);
    // until == second.timestamp ⇒ both visible (until is inclusive in
    // this stub via `>` comparison).
    expect(
      store.list({ until: second.timestamp }).map((e) => e.resource),
    ).toEqual(['a', 'b']);
    // since strictly after first ⇒ only entries with later timestamps.
    expect(
      store.list({ since: '2999-01-01T00:00:00Z' }).map((e) => e.resource),
    ).toEqual([]);
  });

  it('subscribers are notified on every log; unsubscribe stops notifications', () => {
    const store = createAuditStore();
    const audit = createScopedAuditService(store, { moduleId, userId });
    const listener = vi.fn();
    const unsubscribe = audit.subscribe(listener);

    audit.log({ action: 'view', resource: 'r1' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    audit.log({ action: 'view', resource: 'r2' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clear() empties the store', () => {
    const store = createAuditStore();
    const audit = createScopedAuditService(store, { moduleId, userId });
    audit.log({ action: 'view', resource: 'a' });
    audit.log({ action: 'view', resource: 'b' });
    store.clear();
    expect(store.list()).toEqual([]);
  });
});
