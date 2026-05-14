// Patient Groups bar. Labelled "Patient Groups" so reviewers can see
// the surface that holds multiple concurrent patient contexts. Each
// open group is a chip; the active group is highlighted. A close button
// per group prompts the store (no canClose veto wiring in Step 5).

import { useShellStore } from '../store';
import { navigationService } from '../services';

export function PatientGroupBar(): JSX.Element {
  const groups = useShellStore((s) => s.groups);
  const activeGroupId = useShellStore((s) => s.activeGroupId);

  return (
    <div className="patient-groups" aria-label="Patient groups">
      <span className="panel-label">Patient Groups</span>
      {groups.length === 0 ? (
        <span style={{ color: '#6b7280', fontSize: 12 }}>
          (no patient groups open)
        </span>
      ) : (
        groups.map((g) => {
          const isActive = g.id === activeGroupId;
          return (
            <span
              key={g.id}
              className={`patient-group-chip ${isActive ? 'active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => navigationService.focusPatientGroup(g.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigationService.focusPatientGroup(g.id);
                }
              }}
              aria-label={`Patient group: ${g.patient.displayName}`}
            >
              <span>{g.patient.displayName}</span>
              <span style={{ opacity: 0.7, fontSize: 11 }}>
                ({g.tabIds.length}{' '}
                {g.tabIds.length === 1 ? 'tab' : 'tabs'})
              </span>
              <button
                type="button"
                aria-label={`Close patient group for ${g.patient.displayName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void navigationService.closePatientGroup(g.id);
                }}
              >
                ×
              </button>
            </span>
          );
        })
      )}
    </div>
  );
}
