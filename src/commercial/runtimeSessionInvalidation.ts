/**
 * Couples an authoritative session invalidation with its runtime cleanup.
 * Cleanup also runs when invalidation fails at its durable credential commit
 * point; callers still receive the original failure so the UI remains honest.
 */
export async function runSessionInvalidationWithCleanup(
  invalidate: () => Promise<boolean>,
  cleanup: () => Promise<void>,
): Promise<void> {
  let shouldCleanup = false;
  let invalidationFailure: unknown;
  try {
    shouldCleanup = await invalidate();
  } catch (error) {
    shouldCleanup = true;
    invalidationFailure = error;
  }

  let cleanupFailure: unknown;
  if (shouldCleanup) {
    try {
      await cleanup();
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (invalidationFailure !== undefined) throw invalidationFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
}
