// Create a real patient in the database.
//
// POSTs a new patient via `data.write('Patient', { ... })` (no id →
// POST /patients).  The backend auto-adds the caller to the patient's
// care team in the same transaction so the new row is immediately
// visible to them on read.
//
// The module keeps a session-local list of patients it has created so
// the user has the UUIDs / MRNs at hand while they build out
// patient-scoped modules.  A real `GET /patients` list endpoint will
// replace this local cache once it exists.

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useNavigation, useServices, useSessionContext } from '@emr/module-sdk';

type Sex = 'male' | 'female' | 'intersex' | 'unknown';

interface PatientSummary {
  readonly id: string;
  readonly mrn: string;
  readonly displayName: string;
  readonly dateOfBirth: string;
  readonly sex?: Sex | null;
}

interface FormState {
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: Sex | '';
}

const initialForm: FormState = {
  mrn: '',
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  sex: '',
};

export function PatientCreateView(): JSX.Element {
  const session = useSessionContext();
  const services = useServices();
  const navigation = useNavigation();

  const [form, setForm] = useState<FormState>(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<readonly PatientSummary[]>([]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      // DataService.write's `T` is both input and output; the input
      // is a create-shaped subset of PatientSummary, so widen via
      // `unknown` before narrowing to the response shape.
      const summary = (await services.data.write('Patient', {
        mrn: form.mrn.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        ...(form.sex !== '' && { sex: form.sex }),
      })) as unknown as PatientSummary;

      // The backend has its own audit row (record.create in
      // audit_logs); this frontend entry mirrors it into the
      // AuditPanel so the user sees immediate feedback that something
      // happened, with the new patient ID attached so the row links
      // back to the chart.
      services.audit.log({
        action: 'patient.create',
        resource: summary.id,
        patient: summary.id as never,
      });

      setCreated((prev) => [summary, ...prev]);
      setForm(initialForm);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openPatient(p: PatientSummary): void {
    navigation.openPatientGroup({
      patient: { id: p.id as never, displayName: p.displayName },
    });
  }

  return (
    <div className="module-card">
      <h2>Create Patient</h2>
      <p>
        Logged in as <strong>{session.user.displayName}</strong>. New patients are
        created in the database and the creator is auto-added to the care team as
        primary, so the patient is visible to you on the next read.
      </p>

      {error !== null && (
        <p className="demo-row-meta" role="alert">
          {error}
        </p>
      )}

      <form
        onSubmit={submit}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginTop: 12,
        }}
      >
        <label>
          <div className="demo-row-meta">Medical Record Number (MRN)</div>
          <input
            type="text"
            value={form.mrn}
            onChange={(e) => update('mrn', e.target.value)}
            placeholder="e.g. MRN-0001"
            required
            maxLength={20}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div className="demo-row-meta">Sex at birth</div>
          <select
            value={form.sex}
            onChange={(e) => update('sex', e.target.value as Sex | '')}
            style={{ width: '100%' }}
          >
            <option value="">— not recorded —</option>
            <option value="male">male</option>
            <option value="female">female</option>
            <option value="intersex">intersex</option>
            <option value="unknown">unknown</option>
          </select>
        </label>

        <label>
          <div className="demo-row-meta">First name</div>
          <input
            type="text"
            value={form.firstName}
            onChange={(e) => update('firstName', e.target.value)}
            required
            maxLength={100}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div className="demo-row-meta">Last name</div>
          <input
            type="text"
            value={form.lastName}
            onChange={(e) => update('lastName', e.target.value)}
            required
            maxLength={100}
            style={{ width: '100%' }}
          />
        </label>

        <label style={{ gridColumn: '1 / -1' }}>
          <div className="demo-row-meta">Date of birth (YYYY-MM-DD)</div>
          <input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => update('dateOfBirth', e.target.value)}
            required
            max={new Date().toISOString().slice(0, 10)}
            style={{ width: '100%' }}
          />
        </label>

        <div style={{ gridColumn: '1 / -1' }}>
          <button
            type="submit"
            className="button-secondary"
            disabled={busy || !isValid(form)}
          >
            {busy ? 'Creating…' : 'Create patient'}
          </button>
        </div>
      </form>

      {created.length > 0 && (
        <>
          <h3 style={{ margin: '20px 0 6px 0' }}>Created this session</h3>
          <ul className="demo-list">
            {created.map((p) => (
              <li key={p.id} className="demo-row">
                <div className="demo-row-main">
                  <div className="demo-row-from">
                    {p.displayName}{' '}
                    <span className="demo-row-meta">MRN {p.mrn}</span>
                  </div>
                  <div className="demo-row-subject">
                    DOB {p.dateOfBirth}
                    {p.sex !== undefined && p.sex !== null
                      ? ` · ${p.sex}`
                      : ''}{' '}
                    · ID <code>{p.id}</code>
                  </div>
                </div>
                <div className="demo-row-meta">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => openPatient(p)}
                  >
                    Open patient group
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="demo-row-meta" style={{ marginTop: 8 }}>
            Opening a patient group surfaces a chip in the bar at the bottom of
            the screen. Build a patient-scoped module to render the chart
            contents — see <code>pnpm new-module &lt;name&gt; --scope=patient</code>.
          </p>
        </>
      )}
    </div>
  );
}

function isValid(f: FormState): boolean {
  return (
    f.mrn.trim() !== '' &&
    f.firstName.trim() !== '' &&
    f.lastName.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(f.dateOfBirth)
  );
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
