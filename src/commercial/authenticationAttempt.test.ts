import { describe, expect, it } from 'vitest';
import { AuthenticationAttemptFence } from './authenticationAttempt';

describe('AuthenticationAttemptFence', () => {
  it('accepts only the last login that was initiated', () => {
    const fence = new AuthenticationAttemptFence();
    const accountA = fence.start();
    const accountB = fence.start();

    expect(fence.isCurrent(accountA)).toBe(false);
    expect(fence.isCurrent(accountB)).toBe(true);
  });

  it('invalidates an in-flight login when logout or unmount starts', () => {
    const fence = new AuthenticationAttemptFence();
    const attempt = fence.start();

    fence.invalidate();

    expect(fence.isCurrent(attempt)).toBe(false);
  });
});
