/** Adds a line to the tester log (kept by pre-release builds only; see main/log.ts). */
export function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  try {
    window.reader?.log(level, message);
  } catch {
    // Logging must never break the app.
  }
}

window.addEventListener('error', (e) => log(`Error: ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})${e.error?.stack ? ` ${e.error.stack}` : ''}`, 'error'));
window.addEventListener('unhandledrejection', (e) =>
  log(`Unhandled rejection: ${e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason)}`, 'error'),
);
