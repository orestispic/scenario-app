import { describe, expect, it, vi } from 'vitest';
import { AccountOverviewLoader, invalidateAccountOverviewOnSessionChange } from './accountOverview';

function api() {
  return {
    getMe: vi.fn(async () => ({ account: { id: 'profile-1', email: 'person@example.test', displayName: 'Personne' }, role: 'customer' as const })),
    getEntitlements: vi.fn(async () => ({ snapshot: { id: 'snapshot-1' }, offlineGrant: {} } as never)),
    getDevices: vi.fn(async () => []),
    getBilling: vi.fn(async () => ({ billing: { status: 'none' } } as never)),
    getActivationStatus: vi.fn(async () => ({ activations: [] })),
  };
}

describe('account overview loader', () => {
  it('keeps the profile usable when rights or devices fail independently', async () => {
    const client = api();
    client.getEntitlements.mockRejectedValueOnce(new Error('rights unavailable'));
    client.getDevices.mockRejectedValueOnce(new Error('devices unavailable'));
    const loader = new AccountOverviewLoader();

    const primary = await loader.loadPrimary(client as never);
    const secondary = await loader.loadSecondary(client as never);

    expect(primary.profile.status).toBe('ready');
    expect(primary.entitlements.status).toBe('error');
    expect(secondary.devices.status).toBe('error');
    expect(secondary.billing.status).toBe('ready');
  });

  it('deduplicates concurrent openings and caches short-lived account reads', async () => {
    let now = 1_000;
    const client = api();
    const loader = new AccountOverviewLoader(() => now, 30_000);

    const [first, second] = await Promise.all([
      loader.loadPrimary(client as never),
      loader.loadPrimary(client as never),
    ]);
    expect(first).toBe(second);
    expect(client.getMe).toHaveBeenCalledTimes(1);
    await loader.loadPrimary(client as never);
    expect(client.getMe).toHaveBeenCalledTimes(1);
    now += 30_001;
    await loader.loadPrimary(client as never);
    expect(client.getMe).toHaveBeenCalledTimes(2);
  });

  it('never lets a late response repopulate a cache after account replacement', async () => {
    let finish!: (value: Awaited<ReturnType<ReturnType<typeof api>['getMe']>>) => void;
    const client = api();
    client.getMe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const loader = new AccountOverviewLoader();
    const stale = loader.loadPrimary(client as never);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    loader.invalidate();
    finish({ account: { id: 'old', email: 'old@example.test', displayName: 'Ancien compte' }, role: 'customer' });
    await stale;
    await loader.loadPrimary(client as never);
    expect(client.getMe).toHaveBeenCalledTimes(2);
  });

  it('cannot serve account A from cache after a session changes to account B', async () => {
    let notify!: (authenticated: boolean) => void;
    const source = {
      subscribe(listener: (authenticated: boolean) => void) {
        notify = listener;
        return () => undefined;
      },
    };
    const loader = new AccountOverviewLoader(() => 1_000, 30_000);
    invalidateAccountOverviewOnSessionChange(source, loader);
    const accountA = api();
    const accountB = api();
    accountB.getMe.mockResolvedValue({
      account: { id: 'profile-2', email: 'other@example.test', displayName: 'Autre personne' },
      role: 'customer',
    });

    const first = await loader.loadPrimary(accountA as never);
    expect(first.profile).toMatchObject({ status: 'ready', value: { account: { id: 'profile-1' } } });
    notify(true);
    const second = await loader.loadPrimary(accountB as never);

    expect(second.profile).toMatchObject({ status: 'ready', value: { account: { id: 'profile-2' } } });
    expect(accountA.getMe).toHaveBeenCalledOnce();
    expect(accountB.getMe).toHaveBeenCalledOnce();
  });

  it('keeps the newest forced primary refresh when an older refresh finishes last', async () => {
    let finishOld!: (value: Awaited<ReturnType<ReturnType<typeof api>['getMe']>>) => void;
    const client = api();
    client.getMe.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const loader = new AccountOverviewLoader();

    const oldRefresh = loader.loadPrimary(client as never, true);
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    client.getMe.mockResolvedValue({
      account: { id: 'new', email: 'new@example.test', displayName: 'Compte récent' },
      role: 'customer',
    });
    const newestRefresh = await loader.loadPrimary(client as never, true);
    expect(newestRefresh.profile).toMatchObject({ status: 'ready', value: { account: { id: 'new' } } });

    finishOld({
      account: { id: 'old', email: 'old@example.test', displayName: 'Compte ancien' },
      role: 'customer',
    });
    await oldRefresh;
    const cached = await loader.loadPrimary(client as never);

    expect(cached.profile).toMatchObject({ status: 'ready', value: { account: { id: 'new' } } });
    expect(client.getMe).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest forced secondary refresh when an older refresh finishes last', async () => {
    let finishOld!: (value: Awaited<ReturnType<ReturnType<typeof api>['getDevices']>>) => void;
    const client = api();
    client.getDevices.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const loader = new AccountOverviewLoader();

    const oldRefresh = loader.loadSecondary(client as never, true);
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    client.getDevices.mockResolvedValue([{ id: 'new-device' }] as never);
    const newestRefresh = await loader.loadSecondary(client as never, true);
    expect(newestRefresh.devices).toMatchObject({ status: 'ready', value: [{ id: 'new-device' }] });

    finishOld([{ id: 'old-device' }] as never);
    await oldRefresh;
    const cached = await loader.loadSecondary(client as never);

    expect(cached.devices).toMatchObject({ status: 'ready', value: [{ id: 'new-device' }] });
    expect(client.getDevices).toHaveBeenCalledTimes(2);
  });

  it('uses the revision-aware session stream when it is available', () => {
    const invalidate = vi.fn();
    const subscribe = vi.fn();
    let notify!: () => void;
    const subscribeState = vi.fn((listener: () => void) => {
      notify = listener;
      return () => undefined;
    });

    invalidateAccountOverviewOnSessionChange(
      { subscribe, subscribeState },
      { invalidate },
    );
    expect(subscribeState).toHaveBeenCalledOnce();
    expect(subscribe).not.toHaveBeenCalled();
    notify();
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
