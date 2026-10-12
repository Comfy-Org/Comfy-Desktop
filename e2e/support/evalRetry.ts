/**
 * Retry wrapper for Playwright Electron `app.evaluate(...)` calls. The
 * evaluation channel intermittently throws "Execution context was destroyed"
 * on loaded CI runners when child WebContentsViews churn; a retry on the next
 * tick lands on a fresh, working evaluation context.
 *
 * Only wrap read-only or idempotent evaluations. The error surfaces AFTER the
 * callback may already have executed in the app, so a retried side-effectful
 * callback (emitting an app event, sending IPC, registering a listener) can
 * run twice and turn an exactly-once product action into at-least-once.
 */

// Playwright 1.64 gives CDP's "Promise was collected" a distinct message.
// Earlier versions reported it as a destroyed context; keep the same recovery
// for read-only/idempotent evaluations without changing the retry budget.
const RETRY_PATTERN = /Execution context was destroyed|Resulting promise was garbage collected/i

/** The callback may have completed even though its result was lost. */
export function isLostEvaluationResult(err: unknown): boolean {
  return RETRY_PATTERN.test(err instanceof Error ? err.message : String(err))
}

export async function evalWithRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  shouldRetry: (err: unknown) => boolean = isLostEvaluationResult,
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!shouldRetry(err)) throw err
      await new Promise((r) => setTimeout(r, 50 * (i + 1)))
    }
  }
  throw lastErr
}
