import { describe, it, expect } from 'vitest';
import { parseAiTokenBudgets } from './aiTokenUsage';
import { createAuthenticatedCommercialApi } from './authenticatedApi';

const window = { usedTokens: 10, reservedTokens: 15, limitTokens: 100, usedPercent: 12.34, reservedPercent: 15, costUsedPercent: 1.2, resetsAt: '2026-10-01T00:00:00Z' };
const budgets = { daily: window, monthly: window, blocked: false, updatedAt: '2026-09-13T12:00:00Z' };
describe('budgets IA autoritaires', () => {
  it('conserve le pourcentage serveur sans le recalculer depuis les tokens', async () => {
    const calls: Request[] = [];
    const api = createAuthenticatedCommercialApi({ baseUrl: 'https://api.example.invalid', accessToken: 'synthetic',
      fetcher: async (url, init) => { calls.push(new Request(url, init)); return Response.json({ budgets }); } });
    expect((await api.getAiTokenUsage()).daily.usedPercent).toBe(12.34);
    expect(calls[0].url).toBe('https://api.example.invalid/v4/ai/usage');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers.get('authorization')).toBe('Bearer synthetic');
    expect(await calls[0].text()).toBe('');
  });
  it('refuse des valeurs absentes, invalides ou négatives plutôt que montrer un faux 0 %', () => {
    expect(() => parseAiTokenBudgets(null)).toThrow();
    expect(() => parseAiTokenBudgets({ ...budgets, daily: { ...window, usedPercent: NaN } })).toThrow();
    expect(() => parseAiTokenBudgets({ ...budgets, daily: { ...window, usedTokens: -1 } })).toThrow();
    expect(() => parseAiTokenBudgets({ ...budgets, daily: { ...window, usedPercent: 101 } })).toThrow();
  });
});
