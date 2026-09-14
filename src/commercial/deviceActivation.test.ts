import { expect, it, vi } from 'vitest';
import { DeviceActivation } from './deviceActivation';
import type { DeviceView } from './contractsV2';

it('shares one activation between simultaneous account, AI and cloud requests', async () => {
  const device = { id: 'one' } as DeviceView;
  const activate = vi.fn(async () => device);
  const manager = new DeviceActivation(activate);
  expect(await Promise.all(Array.from({ length: 20 }, () => manager.ensure()))).toEqual(Array(20).fill(device));
  await manager.ensure();
  expect(activate).toHaveBeenCalledTimes(1);
  manager.reset();
  await manager.ensure();
  expect(activate).toHaveBeenCalledTimes(2);
});

it('allows retry after network failure or after freeing a device slot', async () => {
  const activate = vi.fn().mockRejectedValueOnce(new Error('device_limit_reached')).mockResolvedValue({ id: 'one' });
  const manager = new DeviceActivation(activate);
  await expect(manager.ensure()).rejects.toThrow('device_limit_reached');
  expect(await manager.ensure()).toEqual({ id: 'one' });
});

it('does not let a previous account failure reset the new account activation', async () => {
  let reject!: (error: Error) => void;
  const activate = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue({ id: 'new' });
  const manager = new DeviceActivation(activate);
  const previous = manager.ensure();
  manager.reset();
  await manager.ensure();
  reject(new Error('old-session'));
  await expect(previous).rejects.toThrow();
  expect(await manager.ensure()).toEqual({ id: 'new' });
  expect(activate).toHaveBeenCalledTimes(2);
});
