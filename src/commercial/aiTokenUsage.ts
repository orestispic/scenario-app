export const AI_USAGE_CHANGED = 'senario:ai-usage-changed';
export interface AiTokenWindow {
  usedTokens: number;
  reservedTokens: number;
  limitTokens: number;
  usedPercent: number;
  reservedPercent: number;
  costUsedPercent: number;
  resetsAt: string;
}
export interface AiTokenBudgets {
  daily: AiTokenWindow;
  monthly: AiTokenWindow;
  blocked: boolean;
  updatedAt: string;
}
export function parseAiTokenBudgets(value: unknown): AiTokenBudgets {
  if (!value || typeof value !== 'object') throw new Error('Budgets IA indisponibles.');
  const data = value as Record<string, unknown>;
  if (typeof data.blocked !== 'boolean' || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('Budgets IA invalides.');
  for (const key of ['daily', 'monthly']) {
    const window = data[key] as Record<string, unknown> | null;
    if (!window || typeof window !== 'object' || typeof window.resetsAt !== 'string' || !Number.isFinite(Date.parse(window.resetsAt))) throw new Error('Période IA invalide.');
    for (const field of ['usedTokens', 'reservedTokens', 'limitTokens'])
      if (!Number.isSafeInteger(window[field]) || Number(window[field]) < 0) throw new Error('Compteur IA invalide.');
    for (const field of ['usedPercent', 'reservedPercent', 'costUsedPercent'])
      if (typeof window[field] !== 'number' || !Number.isFinite(window[field]) || window[field] < 0 || window[field] > 100) throw new Error('Pourcentage IA invalide.');
  }
  return data as unknown as AiTokenBudgets;
}

export function notifyAiUsageChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AI_USAGE_CHANGED));
}
