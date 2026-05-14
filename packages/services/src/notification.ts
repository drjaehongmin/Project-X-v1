// NotificationService stub. Logs to console so demo modules emit
// something visible in the dev tools; the real chrome (toasts, banners,
// modals) lands with the shell in Step 5 and will replace this.

import type {
  NotificationOptions,
  NotificationService,
} from '@emr/contracts';

export function createNotificationService(): NotificationService {
  return {
    notify(message: string, options?: NotificationOptions) {
      log('notify', message, options);
    },
    banner(message: string, options?: NotificationOptions) {
      log('banner', message, options);
    },
    async alert(message: string) {
      log('alert', message);
    },
    async confirm(message: string): Promise<boolean> {
      log('confirm', message);
      // The prototype auto-confirms. The shell will replace this with a
      // real modal in Step 5.
      return true;
    },
  };
}

function log(kind: string, message: string, options?: NotificationOptions): void {
  // eslint-disable-next-line no-console
  console.info(`[notification:${kind}]`, message, options ?? {});
}
