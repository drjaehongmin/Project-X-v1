// Shown when no tab is active. Plain chrome content — not a module —
// so the loader pipeline only ever runs when a real module is open.

import { useShellStore } from '../store';

export function HomeView(): JSX.Element {
  const session = useShellStore((s) => s.session);
  return (
    <div className="module-content">
      <div className="module-card">
        <h2>Home</h2>
        <p>
          Signed in as <strong>{session?.user.displayName}</strong> on{' '}
          <strong>{session?.location.displayName}</strong>.
        </p>
        <p>
          Choose a module from the <strong>Modules</strong> panel on the
          left to open a tab. Activity will appear in the{' '}
          <strong>Audit Log</strong> on the right as you go.
        </p>
      </div>
    </div>
  );
}
