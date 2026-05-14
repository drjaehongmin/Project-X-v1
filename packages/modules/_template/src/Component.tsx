// The template module's view. New modules generated from this
// template (via `pnpm new-module <name>` in Step 7) start here:
// replace the body with the module's actual UI.
//
// What this file demonstrates:
//   - reading the SessionContext through the SDK hook
//   - rendering inside the shell's `.module-card` chrome class
//
// What this file is NOT:
//   - a place to call services directly. Use `useServices()` and
//     `useNavigation()` from `@emr/module-sdk` when you need them.
//   - a place to define the manifest. The manifest lives in
//     `./index.ts` so the public entry point is a single file.

import { useSessionContext } from '@emr/module-sdk';

export function TemplateView(): JSX.Element {
  const session = useSessionContext();
  return (
    <div className="module-card">
      <h2>Template module</h2>
      <p>
        This is the starter module. It is registered with the shell so
        the loader pipeline has something concrete to mount, and is the
        package <code>pnpm new-module</code> will copy in Step 7.
      </p>
      <p>
        Session for <strong>{session.user.displayName}</strong> at{' '}
        <strong>{session.location.displayName}</strong>{' '}
        ({session.location.kind}).
      </p>
    </div>
  );
}
