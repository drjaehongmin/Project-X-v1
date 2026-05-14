// Audit Log panel. Subscribes to the in-memory audit store and renders
// every entry; the panel is labelled "Audit Log" so reviewers can see
// at a glance that this is the running history of who did what.

import { useEffect, useState } from 'react';
import type { AuditEntry } from '@emr/contracts';
import { auditStore } from '../services';

export function AuditPanel(): JSX.Element {
  const [entries, setEntries] = useState<readonly AuditEntry[]>(() =>
    auditStore.list(),
  );

  useEffect(() => {
    setEntries(auditStore.list());
    return auditStore.subscribe(() => {
      setEntries(auditStore.list());
    });
  }, []);

  return (
    <aside className="panel audit" aria-label="Audit log panel">
      <div className="panel-header">
        <h2>Audit Log</h2>
        <span style={{ fontSize: 11, color: '#6b7280' }}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      <div className="panel-body">
        {entries.length === 0 ? (
          <div className="panel-empty">No audit entries yet.</div>
        ) : (
          [...entries].reverse().map((e) => (
            <div key={e.id} className="audit-entry">
              <div className="audit-time">{formatTime(e.timestamp)}</div>
              <div>
                <span className="audit-action">{e.action}</span>{' '}
                <span className="audit-detail">
                  on <code>{e.resource}</code>
                </span>
              </div>
              <div className="audit-detail">
                module <code>{String(e.module)}</code> · user{' '}
                <code>{String(e.user)}</code>
                {e.patient !== undefined && (
                  <>
                    {' '}
                    · patient <code>{String(e.patient)}</code>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function formatTime(iso: string): string {
  // Browser-friendly local-time display. Falls back to the raw string
  // if parsing fails for any reason.
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}
