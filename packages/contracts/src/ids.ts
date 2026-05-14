// Branded ID types. Erased at runtime; nominal at compile time.
// Use the branded type (e.g. `UserId`) instead of raw `string` so that
// passing a `PatientId` where a `UserId` is expected fails to compile.

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type LocationId = Brand<string, 'LocationId'>;
export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type PatientId = Brand<string, 'PatientId'>;
export type PatientGroupId = Brand<string, 'PatientGroupId'>;
export type ModuleId = Brand<string, 'ModuleId'>;
export type TabId = Brand<string, 'TabId'>;
export type AuditEntryId = Brand<string, 'AuditEntryId'>;
