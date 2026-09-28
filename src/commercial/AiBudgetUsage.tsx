import { useEffect, useState } from 'react';
import { createRuntimeCommercialApi, sessions } from './runtime';
import { AI_USAGE_CHANGED, shouldRequestAiTokenUsage, type AiTokenBudgets } from './aiTokenUsage';
import { UiProgress } from '../ui';
import './aiBudgetUsage.css';

export function AiBudgetUsage() {
  const [budgets, setBudgets] = useState<AiTokenBudgets | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let authenticated = false;
    let pending = false;
    let again = false;
    let generation = 0;
    async function refresh() {
      if (!shouldRequestAiTokenUsage(authenticated, navigator.onLine, document.hidden)) return;
      if (pending) { again = true; return; }
      pending = true;
      const current = generation;
      try {
        const value = await createRuntimeCommercialApi().getAiTokenUsage();
        if (active && current === generation) { setBudgets(value); setError(false); }
      } catch { if (active && current === generation) { setBudgets(null); setError(true); } }
      finally {
        pending = false;
        if (active && again) { again = false; void refresh(); }
      }
    }
    const stopSession = sessions.subscribe(nextAuthenticated => {
      if (authenticated === nextAuthenticated) return;
      authenticated = nextAuthenticated;
      generation++;
      setBudgets(null);
      setError(!nextAuthenticated);
      if (nextAuthenticated) void refresh();
    });
    const restoreSession = async () => {
      if (!navigator.onLine) {
        if (active) setError(true);
        return;
      }
      try {
        const restoreGeneration = generation;
        const token = await sessions.getAccessToken();
        if (!active) return;
        if (!token) {
          authenticated = false;
          setBudgets(null);
          setError(true);
          return;
        }
        if (!authenticated) {
          authenticated = true;
          generation++;
          void refresh();
        } else if (generation === restoreGeneration) {
          // An already-restored in-memory session does not publish again.
          // Refresh it here; if getAccessToken published, the listener did it.
          void refresh();
        }
      } catch {
        if (active) setError(true);
      }
    };
    const stopForOffline = () => {
      generation++;
      again = false;
      setError(true);
    };
    void restoreSession();
    // An AI completion already emits AI_USAGE_CHANGED immediately. The
    // periodic check is only a safety net for server-side entitlement changes,
    // so one request per minute is sufficient and avoids needless polling.
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener(AI_USAGE_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', restoreSession);
    window.addEventListener('offline', stopForOffline);
    return () => {
      active = false; clearInterval(timer);
      stopSession();
      window.removeEventListener(AI_USAGE_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', restoreSession);
      window.removeEventListener('offline', stopForOffline);
    };
  }, []);
  return <section className="ai-budget-usage" aria-label="Utilisation de l’IA" aria-live="polite">
    <h3>Utilisation de l’IA</h3>
    {!budgets ? <p>{error ? 'Budgets indisponibles. Une connexion est nécessaire pour les vérifier.' : 'Vérification des budgets…'}</p> : <>
      <div className="ai-budget-periods">
        {(['daily', 'monthly'] as const).map(key => {
          const budget = budgets[key];
          // The server remains authoritative for usage. This is only the inverse
          // visual representation requested by the product: available credit.
          const remainingPercentage = Math.max(0, Math.min(100, 100 - budget.usedPercent));
          const periodLabel = key === 'daily' ? 'journalier' : 'mensuel';
          return <div key={key} className="ai-budget-period">
            <p>Crédit IA {periodLabel} restant : <strong>{remainingPercentage.toLocaleString('fr-FR')} %</strong></p>
            <UiProgress
              value={remainingPercentage}
              aria-label={`Crédit IA ${periodLabel} restant`}
              valueText={`${remainingPercentage.toLocaleString('fr-FR')} % de crédit IA ${periodLabel} restant`}
              tone={remainingPercentage <= 10 ? 'danger' : remainingPercentage <= 25 ? 'warning' : 'info'}
            />
          </div>;
        })}
      </div>
      {budgets.blocked && <p role="status">Budget IA atteint ou en attente de vérification. L’écriture reste disponible.</p>}
    </>}
  </section>;
}
