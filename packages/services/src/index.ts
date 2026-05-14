// @emr/services — concrete (prototype-stub) implementations of the
// service interfaces declared in @emr/contracts. The shell instantiates
// these and injects per-module instances through props; modules never
// import this package directly.

export {
  createAuditStore,
  createScopedAuditService,
} from './audit';
export type { AuditScope, AuditStore } from './audit';

export { createDataService } from './data';
export { samplePatients } from './fixtures';

export { createNavigationService } from './navigation';
export type { NavigationStore } from './navigation';

export { createNotificationService } from './notification';

export { createPermissionService } from './permission';
export type { PermissionContext } from './permission';
