import { useEffect, useState } from 'react';
import { offlineLicense } from './runtime';
import { UiTooltip } from '../ui';

export function OfflineLicenseStatus() {
  const [state, setState] = useState(offlineLicense.state);
  useEffect(() => {
    const unsubscribe = offlineLicense.subscribe(() => setState(offlineLicense.state));
    const stop = offlineLicense.start();
    return () => { unsubscribe(); stop(); };
  }, []);
  const remainingDays = state.expiresAt
    ? Math.ceil((Date.parse(state.expiresAt) - Date.now()) / 86_400_000)
    : null;
  const label = state.kind === 'valid' && remainingDays !== null && remainingDays <= 2
    ? `Connexion bientôt obligatoire : vérifiez votre abonnement avant le ${new Date(state.expiresAt!).toLocaleDateString('fr-FR')}.`
    : state.kind === 'valid' && remainingDays !== null && remainingDays <= 5
      ? `Senario devra bientôt vérifier votre abonnement. Connectez-vous avant le ${new Date(state.expiresAt!).toLocaleDateString('fr-FR')}.`
    : state.kind === 'valid' && remainingDays !== null && remainingDays <= 9
      ? `Accès hors ligne valide jusqu’au ${new Date(state.expiresAt!).toLocaleDateString('fr-FR')}.`
    : state.kind === 'valid'
    ? `Licence hors ligne : jusqu’au ${new Date(state.expiresAt!).toLocaleDateString('fr-FR')}`
    : state.kind === 'clock-error' ? 'Horloge modifiée : reconnectez-vous. Édition locale disponible.'
    : state.kind === 'expired' ? 'Licence hors ligne expirée : édition locale disponible. Reconnectez-vous.'
    : 'Édition locale disponible';
  return <UiTooltip content={label} placement="top"><span>{label}</span></UiTooltip>;
}
