import { describe, expect, it, vi } from 'vitest';
import { AuthSessionError } from './auth';
import { CommercialHttpError } from './authenticatedApi';
import {
  ACCOUNT_CLOSURE_CONFIRMATION,
  accountClosureErrorMessage,
  createAccountClosureVerificationToken,
  isAccountClosureResultUncertain,
  runAccountClosure,
  type AccountClosureDependencies,
} from './accountClosure';
import type { SessionTokens } from './contractsV2';

const session: SessionTokens = {
  accessToken: 'fresh-access-token',
  refreshToken: 'fresh-refresh-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const accountId = '10000000-0000-4000-8000-000000000002';
const verificationToken = 'V'.repeat(43);

function dependencies(overrides: Partial<AccountClosureDependencies> = {}): AccountClosureDependencies {
  return {
    auth: { signIn: vi.fn(async () => session) },
    checkLocalSafety: vi.fn(async () => undefined),
    acceptSession: vi.fn(async () => undefined),
    confirmIrreversible: vi.fn(async () => true),
    createVerificationToken: vi.fn(() => verificationToken),
    persistPending: vi.fn(async () => undefined),
    clearPending: vi.fn(async () => undefined),
    closeRemote: vi.fn(async () => undefined),
    verifyRemote: vi.fn(async () => ({ closed: false })),
    purgeLocal: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('voluntary account closure', () => {
  it('creates a fresh 256-bit URL-safe verification receipt', () => {
    const first = createAccountClosureVerificationToken();
    const second = createAccountClosureVerificationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it.each([
    { currentPassword: '', confirmation: ACCOUNT_CLOSURE_CONFIRMATION },
    { currentPassword: 'current-password', confirmation: 'close my account' },
  ])('does not authenticate or call the API without both explicit confirmations', async (input) => {
    const deps = dependencies();
    await expect(runAccountClosure({ accountId, email: 'writer@example.test', ...input }, deps)).rejects.toBeInstanceOf(AuthSessionError);
    expect(deps.confirmIrreversible).not.toHaveBeenCalled();
    expect(deps.auth.signIn).not.toHaveBeenCalled();
    expect(deps.closeRemote).not.toHaveBeenCalled();
    expect(deps.purgeLocal).not.toHaveBeenCalled();
  });

  it('does nothing when the irreversible confirmation dialog is cancelled', async () => {
    const deps = dependencies({ confirmIrreversible: vi.fn(async () => false) });
    await expect(runAccountClosure({
      accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
    }, deps)).resolves.toBe(false);
    expect(deps.auth.signIn).not.toHaveBeenCalled();
    expect(deps.closeRemote).not.toHaveBeenCalled();
    expect(deps.purgeLocal).not.toHaveBeenCalled();
  });

  it('blocks on recoverable unsynchronised work before confirmation or any remote request', async () => {
    const deps = dependencies({
      checkLocalSafety: vi.fn(async () => {
        throw new AuthSessionError('Synchronisez ou téléchargez le projet avant de continuer.', false);
      }),
    });
    await expect(runAccountClosure({
      accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
    }, deps)).rejects.toThrow('Synchronisez');
    expect(deps.confirmIrreversible).not.toHaveBeenCalled();
    expect(deps.auth.signIn).not.toHaveBeenCalled();
    expect(deps.closeRemote).not.toHaveBeenCalled();
    expect(deps.purgeLocal).not.toHaveBeenCalled();
  });

  it('purges the accepted session only after the remote 202 operation resolves', async () => {
    let sessionActive = true;
    const order: string[] = [];
    const deps = dependencies({
      acceptSession: vi.fn(async () => { sessionActive = true; order.push('session'); }),
      closeRemote: vi.fn(async () => { order.push('remote-202'); }),
      purgeLocal: vi.fn(async () => { sessionActive = false; order.push('purge'); }),
    });
    await expect(runAccountClosure({
      accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
    }, deps)).resolves.toBe(true);
    expect(order).toEqual(['session', 'remote-202', 'purge']);
    expect(sessionActive).toBe(false);
    expect(deps.persistPending).toHaveBeenCalledWith(expect.objectContaining({
      accountId,
      verificationToken,
      schemaVersion: 1,
    }));
    expect(deps.clearPending).toHaveBeenCalledOnce();
  });

  it('resumes an uncertain closure with the exact durable receipt instead of creating a second attempt', async () => {
    const pending = {
      schemaVersion: 1 as const,
      accountId,
      verificationToken,
      createdAt: '2026-09-20T10:00:00.000Z',
    };
    const deps = dependencies();
    await expect(runAccountClosure({
      accountId,
      email: 'writer@example.test',
      currentPassword: 'current-password',
      confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
      pending,
    }, deps)).resolves.toBe(true);
    expect(deps.createVerificationToken).not.toHaveBeenCalled();
    expect(deps.persistPending).not.toHaveBeenCalled();
    expect(deps.closeRemote).toHaveBeenCalledWith(verificationToken);
    expect(deps.purgeLocal).toHaveBeenCalledOnce();
    expect(deps.clearPending).toHaveBeenCalledOnce();
  });

  it('refuses to reuse a receipt from another account before calling the close endpoint', async () => {
    const deps = dependencies();
    await expect(runAccountClosure({
      accountId,
      email: 'writer@example.test',
      currentPassword: 'current-password',
      confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
      pending: {
        schemaVersion: 1,
        accountId: '20000000-0000-4000-8000-000000000002',
        verificationToken,
        createdAt: '2026-09-20T10:00:00.000Z',
      },
    }, deps)).rejects.toThrow(/autre compte/i);
    expect(deps.closeRemote).not.toHaveBeenCalled();
  });

  it('keeps the session and does not verify or purge after a deterministic 4xx rejection', async () => {
    const failure = new CommercialHttpError(400, 'account_closure_confirmation_required', 'SQLSTATE secret leaked by provider');
    const deps = dependencies({ closeRemote: vi.fn(async () => { throw failure; }) });
    await expect(runAccountClosure({
      accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
    }, deps)).rejects.toBe(failure);
    expect(deps.verifyRemote).not.toHaveBeenCalled();
    expect(deps.purgeLocal).not.toHaveBeenCalled();
    expect(deps.clearPending).toHaveBeenCalledOnce();
    const message = accountClosureErrorMessage(failure);
    expect(message).toContain('reste ouvert');
    expect(message).not.toMatch(/SQLSTATE|connection string|secret host|provider/i);
  });

  it('keeps an absent receipt uncertain immediately after a lost close response', async () => {
    const deps = dependencies({
      closeRemote: vi.fn(async () => { throw new DOMException('lost response', 'TimeoutError'); }),
    });
    await expect(runAccountClosure({
      accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
    }, deps)).rejects.toMatchObject({ verificationToken, accountId });
    expect(deps.verifyRemote).toHaveBeenCalledOnce();
    expect(deps.purgeLocal).not.toHaveBeenCalled();
    expect(deps.clearPending).not.toHaveBeenCalled();
  });

  it('purges local data only when the unambiguous closure receipt confirms it', async () => {
    const deps = dependencies({
      closeRemote: vi.fn(async () => { throw new TypeError('lost response'); }),
      verifyRemote: vi.fn(async () => ({ closed: true })),
    });
    await expect(runAccountClosure({
      accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
    }, deps)).resolves.toBe(true);
    expect(deps.verifyRemote).toHaveBeenCalledOnce();
    expect(deps.purgeLocal).toHaveBeenCalledOnce();
    expect(deps.closeRemote).toHaveBeenCalledWith(verificationToken);
    expect(deps.verifyRemote).toHaveBeenCalledWith(verificationToken);
    expect(deps.clearPending).toHaveBeenCalledOnce();
  });

  it.each([401, 404])('never treats a generic HTTP %s as proof of deletion', async (status) => {
    const deps = dependencies({
      closeRemote: vi.fn(async () => { throw new TypeError('lost response'); }),
      verifyRemote: vi.fn(async () => {
        throw new CommercialHttpError(status, 'session_expired', 'not a closure receipt');
      }),
    });
    let failure: unknown;
    try {
      await runAccountClosure({
        accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
      }, deps);
    } catch (error) {
      failure = error;
    }
    expect(isAccountClosureResultUncertain(failure)).toBe(true);
    expect(deps.purgeLocal).not.toHaveBeenCalled();
  });

  it('preserves the session and reports an uncertain state if verification also loses the network', async () => {
    const deps = dependencies({
      closeRemote: vi.fn(async () => { throw new TypeError('first private network detail'); }),
      verifyRemote: vi.fn(async () => { throw new TypeError('second private network detail'); }),
    });
    let failure: unknown;
    try {
      await runAccountClosure({
        accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
      }, deps);
    } catch (error) {
      failure = error;
    }
    expect(isAccountClosureResultUncertain(failure)).toBe(true);
    expect(deps.verifyRemote).toHaveBeenCalledOnce();
    expect(deps.purgeLocal).not.toHaveBeenCalled();
    expect(accountClosureErrorMessage(failure)).toMatch(/impossible à confirmer/i);
    expect(accountClosureErrorMessage(failure)).not.toMatch(/private network detail/i);
  });

  it('never sends the irreversible request if the receipt cannot be persisted first', async () => {
    const deps = dependencies({
      persistPending: vi.fn(async () => { throw new Error('vault locked'); }),
    });
    await expect(runAccountClosure({
      accountId, email: 'writer@example.test', currentPassword: 'current-password', confirmation: ACCOUNT_CLOSURE_CONFIRMATION,
    }, deps)).rejects.toThrow('vault locked');
    expect(deps.closeRemote).not.toHaveBeenCalled();
    expect(deps.purgeLocal).not.toHaveBeenCalled();
  });

  it('explains that billing must be cancelled without leaking the backend message', () => {
    const error = new CommercialHttpError(
      409,
      'account_subscription_active',
      'account_subscription_active with private provider detail',
      'request-safe-reference',
    );
    const message = accountClosureErrorMessage(error);
    expect(message).toMatch(/Résiliez-le depuis la facturation/);
    expect(message).toContain('Votre compte reste ouvert');
    expect(message).toContain('request-safe-reference');
    expect(message).not.toContain('private provider detail');
  });
});
