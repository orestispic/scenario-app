import { useEffect, useState } from 'react';
import { createRuntimeCommercialApi, sessions } from './runtime';
import { AI_USAGE_CHANGED, type AiTokenBudgets } from './aiTokenUsage';
import './aiBudgetUsage.css';

export function AiBudgetUsage() {
  const [budgets, setBudgets] = useState<AiTokenBudgets | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    let again = false;
    let generation = 0;
    async function refresh() {
      if (document.hidden) return;
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
    void refresh();
    const unsubscribe = sessions.subscribe(authenticated => {
      generation++;
      setBudgets(null);
      if (authenticated) void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener(AI_USAGE_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false; clearInterval(timer);
      unsubscribe();
      window.removeEventListener(AI_USAGE_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
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
            <div
              className="ai-budget-progress"
              role="progressbar"
              aria-label={`Crédit IA ${periodLabel} restant`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={remainingPercentage}
              aria-valuetext={`${remainingPercentage.toLocaleString('fr-FR')} % de crédit IA ${periodLabel} restant`}
            >
              <span style={{ width: `${remainingPercentage}%` }} />
            </div>
          </div>;
        })}
      </div>
      {budgets.blocked && <p role="status">Budget IA atteint ou en attente de vérification. L’écriture reste disponible.</p>}
    </>}
  </section>;
}
