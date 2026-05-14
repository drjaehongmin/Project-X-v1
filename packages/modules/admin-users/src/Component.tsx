// Admin · Users & Access — the IAM admin surface.
//
// Three workflows in one card:
//   1. Create a user (email, names, password, user_type)
//   2. Create a role (name, description)
//   3. Grant a role to a user, optionally scoped to a facility
//
// Each section refreshes the underlying list (users / roles / grants)
// after a successful write.  The "set row-based security" piece is
// step 3: a `user_roles` row narrows a user's effective access to a
// facility because RLS policies read `app_current_facility_id()` and
// the role set at login time.
//
// Module visibility: gated by `permissions: ['user.write']` in the
// manifest, which today is only granted to the `admin` role.

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useServices, useSessionContext } from '@emr/module-sdk';

type UserType = 'staff' | 'provider' | 'admin' | 'patient';

interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly surname: string;
  readonly userType: UserType;
  readonly isActive: boolean;
  readonly createdAt: string;
}

interface RoleSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
}

interface UserRoleSummary {
  readonly userId: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly facilityId: string | null;
  readonly facilityName: string | null;
  readonly createdAt: string;
}

type AsyncStatus = 'loading' | 'ready' | 'error';
interface AsyncList<T> {
  readonly status: AsyncStatus;
  readonly value: readonly T[];
  readonly error: string | null;
}

const USER_TYPES: readonly UserType[] = ['staff', 'provider', 'admin', 'patient'];

const initialList = <T,>(): AsyncList<T> => ({
  status: 'loading',
  value: [],
  error: null,
});

export function AdminUsersView(): JSX.Element {
  const session = useSessionContext();
  const services = useServices();

  const [users, setUsers] = useState<AsyncList<UserSummary>>(
    initialList<UserSummary>(),
  );
  const [roles, setRoles] = useState<AsyncList<RoleSummary>>(
    initialList<RoleSummary>(),
  );
  const [grants, setGrants] = useState<AsyncList<UserRoleSummary>>(
    initialList<UserRoleSummary>(),
  );
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const refreshUsers = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setUsers((p) => ({ ...p, status: 'loading', error: null }));
      try {
        const rows = await services.data.search<UserSummary>('User', {
          ...(signal !== undefined && { signal }),
        });
        if (signal?.aborted === true) return;
        setUsers({ status: 'ready', value: rows, error: null });
      } catch (err) {
        if (signal?.aborted === true) return;
        setUsers({ status: 'error', value: [], error: errMessage(err) });
      }
    },
    [services.data],
  );

  const refreshRoles = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setRoles((p) => ({ ...p, status: 'loading', error: null }));
      try {
        const rows = await services.data.search<RoleSummary>('Role', {
          ...(signal !== undefined && { signal }),
        });
        if (signal?.aborted === true) return;
        setRoles({ status: 'ready', value: rows, error: null });
      } catch (err) {
        if (signal?.aborted === true) return;
        setRoles({ status: 'error', value: [], error: errMessage(err) });
      }
    },
    [services.data],
  );

  const refreshGrants = useCallback(
    async (userId: string): Promise<void> => {
      if (userId === '') {
        setGrants({ status: 'ready', value: [], error: null });
        return;
      }
      setGrants((p) => ({ ...p, status: 'loading', error: null }));
      try {
        const rows = await services.data.search<UserRoleSummary>('UserRole', {
          params: { userId },
        });
        setGrants({ status: 'ready', value: rows, error: null });
      } catch (err) {
        setGrants({ status: 'error', value: [], error: errMessage(err) });
      }
    },
    [services.data],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshUsers(controller.signal);
    void refreshRoles(controller.signal);
    return () => controller.abort();
  }, [refreshUsers, refreshRoles]);

  useEffect(() => {
    void refreshGrants(selectedUserId);
  }, [selectedUserId, refreshGrants]);

  return (
    <div className="module-card" style={{ maxWidth: 960 }}>
      <h2>Users &amp; Access</h2>
      <p>
        Logged in as <strong>{session.user.displayName}</strong>. Create users,
        define roles, and grant roles (optionally scoped to a facility). A
        role grant is what gives a user RLS-permitted access at runtime: the
        backend reads <code>user_roles</code> at login and stamps the JWT,
        which Postgres policies evaluate against on every query.
      </p>

      <CreateUserSection
        onCreated={() => {
          void refreshUsers();
          services.audit.log({
            action: 'user.create.submitted',
            resource: 'iam',
          });
        }}
        onError={(msg) =>
          setUsers((p) => ({ ...p, error: msg }))
        }
      />

      <UserList users={users} onSelect={setSelectedUserId} selected={selectedUserId} />

      <hr style={{ margin: '20px 0', border: 0, borderTop: '1px solid #e5e7eb' }} />

      <CreateRoleSection
        onCreated={() => {
          void refreshRoles();
          services.audit.log({
            action: 'role.create.submitted',
            resource: 'iam',
          });
        }}
        onError={(msg) =>
          setRoles((p) => ({ ...p, error: msg }))
        }
      />

      <RoleList roles={roles} />

      <hr style={{ margin: '20px 0', border: 0, borderTop: '1px solid #e5e7eb' }} />

      <GrantSection
        users={users.value}
        roles={roles.value}
        selectedUserId={selectedUserId}
        onSelectedUserIdChange={setSelectedUserId}
        onGranted={() => {
          void refreshGrants(selectedUserId);
          services.audit.log({
            action: 'userRole.grant.submitted',
            resource: 'iam',
          });
        }}
        onError={(msg) =>
          setGrants((p) => ({ ...p, error: msg }))
        }
      />

      <GrantList grants={grants} selectedUserId={selectedUserId} />
    </div>
  );
}

// ---------- Sections ----------

function CreateUserSection({
  onCreated,
  onError,
}: {
  readonly onCreated: () => void;
  readonly onError: (message: string) => void;
}): JSX.Element {
  const services = useServices();
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    surname: '',
    userType: 'staff' as UserType,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await services.data.write('User', {
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        userType: form.userType,
      });
      setForm({
        email: '',
        password: '',
        firstName: '',
        surname: '',
        userType: 'staff',
      });
      onCreated();
    } catch (err) {
      onError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 style={{ margin: '16px 0 6px' }}>Create user</h3>
      <form
        onSubmit={submit}
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 2fr 1fr 1fr auto',
          gap: 8,
          alignItems: 'end',
        }}
      >
        <label>
          <div className="demo-row-meta">Email</div>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
            maxLength={320}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div className="demo-row-meta">Password (≥ 8 chars)</div>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
            minLength={8}
            maxLength={200}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div className="demo-row-meta">First name</div>
          <input
            type="text"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            required
            maxLength={200}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div className="demo-row-meta">Surname</div>
          <input
            type="text"
            value={form.surname}
            onChange={(e) => setForm((f) => ({ ...f, surname: e.target.value }))}
            required
            maxLength={200}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div className="demo-row-meta">User type</div>
          <select
            value={form.userType}
            onChange={(e) =>
              setForm((f) => ({ ...f, userType: e.target.value as UserType }))
            }
            style={{ width: '100%' }}
          >
            {USER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div style={{ gridColumn: '1 / -1' }}>
          <button
            type="submit"
            className="button-secondary"
            disabled={busy}
          >
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </>
  );
}

function UserList({
  users,
  onSelect,
  selected,
}: {
  readonly users: AsyncList<UserSummary>;
  readonly onSelect: (id: string) => void;
  readonly selected: string;
}): JSX.Element {
  if (users.status === 'loading') {
    return <p className="demo-row-meta">Loading users…</p>;
  }
  if (users.error !== null) {
    return (
      <p className="demo-row-meta" role="alert">
        {users.error}
      </p>
    );
  }
  if (users.value.length === 0) {
    return <p className="demo-row-meta">No users yet.</p>;
  }
  return (
    <ul className="demo-list">
      {users.value.map((u) => (
        <li
          key={u.id}
          className={selected === u.id ? 'demo-row demo-row-unread' : 'demo-row'}
        >
          <div className="demo-row-main">
            <div className="demo-row-from">
              {u.firstName} {u.surname}{' '}
              <span className="demo-row-meta">({u.userType})</span>
            </div>
            <div className="demo-row-subject">
              {u.email} · <code>{u.id}</code>
            </div>
          </div>
          <div className="demo-row-meta">
            <button
              type="button"
              className="button-secondary"
              onClick={() => onSelect(u.id)}
            >
              {selected === u.id ? 'Selected' : 'Manage roles'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CreateRoleSection({
  onCreated,
  onError,
}: {
  readonly onCreated: () => void;
  readonly onError: (message: string) => void;
}): JSX.Element {
  const services = useServices();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy || name.trim() === '') return;
    setBusy(true);
    try {
      await services.data.write('Role', {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
      });
      setName('');
      setDescription('');
      onCreated();
    } catch (err) {
      onError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 style={{ margin: '16px 0 6px' }}>Create role</h3>
      <form
        onSubmit={submit}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 2fr auto',
          gap: 8,
          alignItems: 'end',
        }}
      >
        <label>
          <div className="demo-row-meta">Name (kebab / snake_case)</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={64}
            pattern="[A-Za-z0-9_\-]+"
            style={{ width: '100%' }}
            placeholder="e.g. triage-nurse"
          />
        </label>
        <label>
          <div className="demo-row-meta">Description</div>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            style={{ width: '100%' }}
          />
        </label>
        <button type="submit" className="button-secondary" disabled={busy}>
          {busy ? 'Creating…' : 'Create role'}
        </button>
      </form>
    </>
  );
}

function RoleList({
  roles,
}: {
  readonly roles: AsyncList<RoleSummary>;
}): JSX.Element {
  if (roles.status === 'loading') {
    return <p className="demo-row-meta">Loading roles…</p>;
  }
  if (roles.error !== null) {
    return (
      <p className="demo-row-meta" role="alert">
        {roles.error}
      </p>
    );
  }
  if (roles.value.length === 0) {
    return <p className="demo-row-meta">No roles defined.</p>;
  }
  return (
    <ul className="demo-list">
      {roles.value.map((r) => (
        <li key={r.id} className="demo-row">
          <div className="demo-row-main">
            <div className="demo-row-from">{r.name}</div>
            <div className="demo-row-subject">
              {r.description ?? '(no description)'}
            </div>
          </div>
          <div className="demo-row-meta">
            <code>{r.id}</code>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GrantSection({
  users,
  roles,
  selectedUserId,
  onSelectedUserIdChange,
  onGranted,
  onError,
}: {
  readonly users: readonly UserSummary[];
  readonly roles: readonly RoleSummary[];
  readonly selectedUserId: string;
  readonly onSelectedUserIdChange: (id: string) => void;
  readonly onGranted: () => void;
  readonly onError: (message: string) => void;
}): JSX.Element {
  const services = useServices();
  const [roleId, setRoleId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId),
    [users, selectedUserId],
  );

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy || selectedUserId === '' || roleId === '') return;
    setBusy(true);
    try {
      await services.data.write('UserRole', {
        userId: selectedUserId,
        roleId,
        ...(facilityId.trim() !== '' && { facilityId: facilityId.trim() }),
      });
      setRoleId('');
      setFacilityId('');
      onGranted();
    } catch (err) {
      onError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 style={{ margin: '16px 0 6px' }}>Grant role (row-based access)</h3>
      <p className="demo-row-meta" style={{ marginTop: 0 }}>
        Pick a user, pick a role, optionally scope to a facility UUID. Leaving
        facility blank grants the role globally (any facility). This is the
        runtime knob behind <code>app_current_roles()</code> and{' '}
        <code>app_current_facility_id()</code>.
      </p>
      <form
        onSubmit={submit}
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 2fr 2fr auto',
          gap: 8,
          alignItems: 'end',
        }}
      >
        <label>
          <div className="demo-row-meta">User</div>
          <select
            value={selectedUserId}
            onChange={(e) => onSelectedUserIdChange(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">— pick a user —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.surname} ({u.email})
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="demo-row-meta">Role</div>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">— pick a role —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="demo-row-meta">Facility UUID (optional)</div>
          <input
            type="text"
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
            placeholder="leave blank for global"
            style={{ width: '100%' }}
          />
        </label>
        <button
          type="submit"
          className="button-secondary"
          disabled={busy || selectedUserId === '' || roleId === ''}
        >
          {busy ? 'Granting…' : 'Grant'}
        </button>
      </form>
      {selectedUser !== undefined && (
        <p className="demo-row-meta" style={{ marginTop: 8 }}>
          Granting to <strong>{selectedUser.firstName} {selectedUser.surname}</strong>
          {' '}(<code>{selectedUser.id}</code>).
        </p>
      )}
    </>
  );
}

function GrantList({
  grants,
  selectedUserId,
}: {
  readonly grants: AsyncList<UserRoleSummary>;
  readonly selectedUserId: string;
}): JSX.Element {
  if (selectedUserId === '') return <></>;
  if (grants.status === 'loading') {
    return <p className="demo-row-meta">Loading grants…</p>;
  }
  if (grants.error !== null) {
    return (
      <p className="demo-row-meta" role="alert">
        {grants.error}
      </p>
    );
  }
  if (grants.value.length === 0) {
    return <p className="demo-row-meta">No role grants for this user yet.</p>;
  }
  return (
    <>
      <h4 style={{ margin: '12px 0 4px' }}>Current grants</h4>
      <ul className="demo-list">
        {grants.value.map((g) => (
          <li key={`${g.roleId}-${g.facilityId ?? 'global'}`} className="demo-row">
            <div className="demo-row-main">
              <div className="demo-row-from">{g.roleName}</div>
              <div className="demo-row-subject">
                {g.facilityId === null
                  ? 'global scope'
                  : `at ${g.facilityName ?? g.facilityId}`}
              </div>
            </div>
            <div className="demo-row-meta">{formatDate(g.createdAt)}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
