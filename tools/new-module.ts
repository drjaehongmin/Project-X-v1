#!/usr/bin/env node
// new-module — scaffolds a new module from packages/modules/_template.
//
// Usage:
//   pnpm new-module <name>
//   pnpm new-module <name> --scope=<global|session|general|patient>
//
// Behavior:
//   1. Copies the template directory to packages/modules/<name>/.
//   2. Rewrites the new package's package.json (name → @emr/module-<name>).
//   3. Regenerates src/index.ts with the right manifest (id, displayName,
//      scope, requires, type narrowed to NonPatientModuleManifest /
//      PatientModuleManifest as appropriate).
//   4. Regenerates src/Component.tsx with a minimal view whose heading is
//      the module's display name and nothing else clinically meaningful.
//   5. Overwrites CLAUDE.md with a per-module stub.
//   6. Registers the module in the shell:
//        - packages/shell/src/modules/registered.ts (import + array entry)
//        - packages/shell/package.json (workspace dep, sorted)
//        - packages/shell/tsconfig.json (project reference)
//   7. Prints a "next steps" message.
//
// The script aborts (without partial writes only inside the new module
// directory; the shell files are mutated last) if the target directory
// already exists. It is idempotent against the registered.ts and
// package.json (it checks for an existing entry before inserting).

import {
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = resolve(REPO_ROOT, 'packages/modules/_template');
const MODULES_DIR = resolve(REPO_ROOT, 'packages/modules');
const SHELL_REGISTERED = resolve(
  REPO_ROOT,
  'packages/shell/src/modules/registered.ts',
);
const SHELL_PACKAGE_JSON = resolve(REPO_ROOT, 'packages/shell/package.json');
const SHELL_TSCONFIG = resolve(REPO_ROOT, 'packages/shell/tsconfig.json');

const VALID_SCOPES = ['global', 'session', 'general', 'patient'] as const;
type Scope = (typeof VALID_SCOPES)[number];

interface CliArgs {
  readonly name: string;
  readonly scope: Scope;
}

// ---- main --------------------------------------------------------------

function main(): void {
  const args = parseCli();
  const targetDir = resolve(MODULES_DIR, args.name);

  if (existsSync(targetDir)) {
    fail(`target directory already exists: packages/modules/${args.name}`);
  }

  cpSync(TEMPLATE_DIR, targetDir, {
    recursive: true,
    // Skip build artifacts. They are gitignored and would just confuse
    // anyone inspecting the freshly generated module.
    filter: (src) =>
      !src.includes(`${sep}dist${sep}`) &&
      !src.endsWith(`${sep}dist`) &&
      !src.endsWith('.tsbuildinfo'),
  });

  rewritePackageJson(targetDir, args);
  writeNewIndexTs(targetDir, args);
  writeNewComponentTsx(targetDir, args);
  writeNewClaudeMd(targetDir, args);

  updateRegisteredTs(args);
  updateShellPackageJson(args);
  updateShellTsconfig(args);

  reportSuccess(args);
}

// ---- arg parsing -------------------------------------------------------

function parseCli(): CliArgs {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      scope: { type: 'string', default: 'general' },
    },
    allowPositionals: true,
    strict: true,
  });

  if (parsed.positionals.length !== 1) {
    fail('usage: pnpm new-module <name> [--scope=<scope>]');
  }
  const name = parsed.positionals[0]!;

  // kebab-case: lowercase letters/digits, hyphen-separated, must start
  // with a letter. Matches what the rest of the workspace assumes.
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    fail(
      `invalid module name '${name}'. must be lowercase kebab-case ` +
        `(e.g. 'vessel', 'hello-inbox').`,
    );
  }
  if (name === '_template') {
    fail(`'_template' is reserved. choose a different name.`);
  }

  const scopeRaw = parsed.values.scope;
  if (typeof scopeRaw !== 'string' || !isScope(scopeRaw)) {
    fail(
      `invalid --scope '${String(scopeRaw)}'. must be one of: ` +
        VALID_SCOPES.join(', '),
    );
  }

  return { name, scope: scopeRaw };
}

function isScope(s: string): s is Scope {
  return (VALID_SCOPES as readonly string[]).includes(s);
}

function fail(msg: string): never {
  process.stderr.write(`new-module: ${msg}\n`);
  process.exit(1);
}

// ---- naming helpers ----------------------------------------------------

function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((s) => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)))
    .join('');
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.length === 0
    ? pascal
    : pascal[0]!.toLowerCase() + pascal.slice(1);
}

// 'vessel' → 'Vessel'; 'hello-inbox' → 'Hello Inbox'. Per the project
// convention, the display name is the module name with words split on
// hyphens and the first letter of each word capitalized — no other
// "dummy" text.
function toDisplayName(name: string): string {
  return name
    .split('-')
    .map((s) => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)))
    .join(' ');
}

function requiresFor(scope: Scope): readonly ('session' | 'patient')[] {
  if (scope === 'global') return [];
  if (scope === 'patient') return ['session', 'patient'];
  return ['session'];
}

// ---- new-module file writers ------------------------------------------

function rewritePackageJson(targetDir: string, args: CliArgs): void {
  const path = resolve(targetDir, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    unknown
  >;
  pkg['name'] = `@emr/module-${args.name}`;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}

function writeNewIndexTs(targetDir: string, args: CliArgs): void {
  const camel = toCamelCase(args.name);
  const pascal = toPascalCase(args.name);
  const display = toDisplayName(args.name);
  const manifestType =
    args.scope === 'patient'
      ? 'PatientModuleManifest'
      : 'NonPatientModuleManifest';
  const requires = requiresFor(args.scope);
  const requiresLiteral = `[${requires.map((r) => `'${r}'`).join(', ')}]`;

  const content = `import type { ModuleId, ${manifestType} } from '@emr/contracts';
import { defineModule, type ModuleDefinition } from '@emr/module-sdk';

import { ${pascal}View } from './Component';

const manifest: ${manifestType} = {
  id: '${args.name}' as ModuleId,
  displayName: '${display}',
  version: '0.1.0',
  scope: '${args.scope}',
  requires: ${requiresLiteral},
  services: [],
  permissions: [],
};

export const ${camel}Module: ModuleDefinition<${manifestType}> =
  defineModule(manifest, ${pascal}View);

export default ${camel}Module;
`;

  writeFileSync(resolve(targetDir, 'src/index.ts'), content);
}

function writeNewComponentTsx(targetDir: string, args: CliArgs): void {
  const pascal = toPascalCase(args.name);
  const display = toDisplayName(args.name);

  let content: string;

  if (args.scope === 'patient') {
    content = `import { usePatientContext, useSessionContext } from '@emr/module-sdk';

export function ${pascal}View(): JSX.Element {
  const session = useSessionContext();
  const { patient } = usePatientContext();
  return (
    <div className="module-card">
      <h2>${display}</h2>
      <p>Patient: {patient.displayName}</p>
      <p>Signed in as {session.user.displayName}.</p>
    </div>
  );
}
`;
  } else if (args.scope === 'global') {
    // Global modules are shell-provided services and have no session.
    // The hook would throw; keep the body minimal.
    content = `export function ${pascal}View(): JSX.Element {
  return (
    <div className="module-card">
      <h2>${display}</h2>
    </div>
  );
}
`;
  } else {
    content = `import { useSessionContext } from '@emr/module-sdk';

export function ${pascal}View(): JSX.Element {
  const session = useSessionContext();
  return (
    <div className="module-card">
      <h2>${display}</h2>
      <p>Signed in as {session.user.displayName}.</p>
    </div>
  );
}
`;
  }

  writeFileSync(resolve(targetDir, 'src/Component.tsx'), content);
}

function writeNewClaudeMd(targetDir: string, args: CliArgs): void {
  const display = toDisplayName(args.name);
  const content = `# @emr/module-${args.name} — Rules

## Purpose

${display} module. (Add a one-paragraph description of what this module does and why it exists. If you cannot say why it exists, the module is probably premature.)

## Manifest summary

- **id:** \`${args.name}\`
- **displayName:** \`${display}\`
- **scope:** \`${args.scope}\`
- **services:** (declare any services this module requests injection of)
- **permissions:** (declare any capability identifiers the user must have)

## Hard rules

- Imports only from \`@emr/contracts\`, \`@emr/module-sdk\`, \`@emr/shared\`, and external libs. No sibling-module imports.
- Single public entry: \`src/index.ts\` exports the \`ModuleDefinition\`.
- Component takes no props. Context arrives via SDK hooks.

## Public API

- \`default\` / \`${toCamelCase(args.name)}Module\`: the registered \`ModuleDefinition\`.
`;
  writeFileSync(resolve(targetDir, 'CLAUDE.md'), content);
}

// ---- shell updates -----------------------------------------------------

function updateRegisteredTs(args: CliArgs): void {
  const camel = toCamelCase(args.name);
  let content = readFileSync(SHELL_REGISTERED, 'utf8');

  if (content.includes(`@emr/module-${args.name}`)) {
    return;
  }

  // Insert the new import after the last existing `@emr/module-*` import.
  const importRegex = /import \{ [^}]+ \} from '@emr\/module-[^']+';\n/g;
  let lastImport: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(content)) !== null) {
    lastImport = m;
  }
  if (lastImport === null) {
    fail(
      'could not locate an existing @emr/module-* import in registered.ts; ' +
        'the file may have been restructured.',
    );
  }
  const insertAt = lastImport.index + lastImport[0].length;
  const newImport = `import { ${camel}Module } from '@emr/module-${args.name}';\n`;
  content = content.slice(0, insertAt) + newImport + content.slice(insertAt);

  // Append the entry to the registeredModules array, before the closing `];`.
  const arrayStart = content.indexOf('registeredModules');
  if (arrayStart < 0) {
    fail('could not locate `registeredModules` in registered.ts.');
  }
  const arrayCloseIdx = content.indexOf('];', arrayStart);
  if (arrayCloseIdx < 0) {
    fail('could not locate end of `registeredModules` array.');
  }
  content =
    content.slice(0, arrayCloseIdx) +
    `  ${camel}Module,\n` +
    content.slice(arrayCloseIdx);

  writeFileSync(SHELL_REGISTERED, content);
}

function updateShellPackageJson(args: CliArgs): void {
  const pkg = JSON.parse(readFileSync(SHELL_PACKAGE_JSON, 'utf8')) as {
    dependencies?: Record<string, string>;
    [k: string]: unknown;
  };
  const deps = { ...(pkg.dependencies ?? {}) };
  const key = `@emr/module-${args.name}`;
  if (deps[key] === 'workspace:*') {
    return;
  }
  deps[key] = 'workspace:*';
  // Sort for stable output.
  pkg.dependencies = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(SHELL_PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n');
}

function updateShellTsconfig(args: CliArgs): void {
  const tsconfig = JSON.parse(readFileSync(SHELL_TSCONFIG, 'utf8')) as {
    references?: Array<{ path: string }>;
    [k: string]: unknown;
  };
  const refs = [...(tsconfig.references ?? [])];
  const newPath = `../modules/${args.name}`;
  if (refs.some((r) => r.path === newPath)) {
    return;
  }
  refs.push({ path: newPath });
  tsconfig.references = refs;
  writeFileSync(SHELL_TSCONFIG, JSON.stringify(tsconfig, null, 2) + '\n');
}

// ---- output ------------------------------------------------------------

function reportSuccess(args: CliArgs): void {
  const display = toDisplayName(args.name);
  const out = [
    '',
    `new-module: created @emr/module-${args.name}`,
    `  directory:    packages/modules/${args.name}`,
    `  display name: ${display}`,
    `  scope:        ${args.scope}`,
    '',
    'updated:',
    '  packages/shell/src/modules/registered.ts',
    '  packages/shell/package.json',
    '  packages/shell/tsconfig.json',
    '',
    'next steps:',
    '  1. pnpm install                 (link the new workspace package)',
    '  2. PORT=5209 pnpm dev           (restart Vite to pick up the new module)',
  ];
  if (args.scope === 'patient') {
    out.push('');
    out.push(
      'note: patient-scoped modules need an active patient group to mount.',
    );
    out.push(
      '      the default LeftNav does not open them directly — they are',
    );
    out.push(
      '      reached through NavigationService.openPatientGroup from another',
    );
    out.push(
      '      module (see hello-schedule in Step 8 for the canonical example).',
    );
  }
  out.push('');
  process.stdout.write(out.join('\n'));
}

main();
