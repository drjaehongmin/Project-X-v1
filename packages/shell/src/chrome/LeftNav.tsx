// Left navigation panel — lists every launchable module (everything
// except global-scoped, filtered by permission). Clicking a row opens a
// tab through NavigationService so navigation always flows through the
// audited path; nothing here pokes the store directly.

import { navigationService, permissionService } from '../services';
import { moduleRegistry } from '../modules/registry';

export function LeftNav(): JSX.Element {
  // Patient-scoped modules are intentionally hidden here. They cannot
  // launch from a top-level button because they need an active patient
  // group; the canonical entry point is another module calling
  // NavigationService.openPatientGroup (e.g. `patient-create` after a
  // successful POST).
  const modules = moduleRegistry
    .listLaunchable((def) =>
      permissionService.canLaunchModule(def.manifest),
    )
    .filter((def) => def.manifest.scope !== 'patient');

  return (
    <aside className="panel leftnav" aria-label="Modules panel">
      <div className="panel-header">
        <h2>Modules</h2>
      </div>
      <div className="panel-body">
        {modules.length === 0 ? (
          <div className="panel-empty">No modules registered.</div>
        ) : (
          <ul className="leftnav-list">
            {modules.map((def) => (
              <li key={def.manifest.id}>
                <button
                  type="button"
                  className="leftnav-item"
                  onClick={() => {
                    navigationService.openTab({ moduleId: def.manifest.id });
                  }}
                >
                  <span>{def.manifest.displayName}</span>
                  <span className="leftnav-scope">{def.manifest.scope}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
