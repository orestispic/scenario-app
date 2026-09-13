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
  return <section className="ai-budget-usage" aria-label="Budgets IA" aria-live="polite">
    <h3>Utilisation de l’IA</h3>
    {!budgets ? <p>{error ? 'Budgets indisponibles. Une connexion est nécessaire pour les vérifier.' : 'Vérification des budgets…'}</p> : <>
      {(['daily', 'monthly'] as const).map(key => {
        const budget = budgets[key];
        return <div key={key} className="ai-budget-period">
          <p>Budget {key === 'daily' ? 'journalier' : 'mensuel'} utilisé : {budget.usedPercent.toLocaleString('fr-FR')} %</p>
          <small>{budget.usedTokens.toLocaleString('fr-FR')} / {budget.limitTokens.toLocaleString('fr-FR')} tokens
            {budget.reservedTokens > 0 && ` · ${budget.reservedTokens.toLocaleString('fr-FR')} réservés (en cours ou à vérifier)`}</small>
        </div>;
      })}
      {budgets.blocked && <p role="status">Budget IA atteint ou en attente de vérification. L’écriture reste disponible.</p>}
      <small>Entrée et sortie incluses. Actualisé après chaque appel et toutes les 15 secondes. Remise à zéro à minuit UTC et le 1er du mois. Un plafond de coût est également appliqué par le serveur.</small>
    </>}
  </section>;
}
