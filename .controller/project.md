---
name: Project-X-v1
ports:
  frontend: 5209
  backend: 5210
servers:
  - name: frontend
    cmd: pnpm --filter @emr/shell run dev
    port: 5209
    port_var: PORT
---

The `backend` port slot (5210) is reserved but no backend service exists
yet — the `@emr/*` workspace currently only has `shell` as a runnable
package. Add a `backend` entry when a server package lands.
