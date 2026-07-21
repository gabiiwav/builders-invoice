import * as Sentry from '@sentry/browser';

let enabled = false;

export function reportError(error, context = {}) {
  console.error(error, context);
  if (enabled) Sentry.captureException(error, { extra: context });
}

export function initializeMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (dsn) {
    Sentry.init({ dsn, environment: import.meta.env.MODE, sendDefaultPii: false });
    enabled = true;
  }
  window.addEventListener('unhandledrejection', event => reportError(event.reason, { source: 'unhandledrejection' }));
}
