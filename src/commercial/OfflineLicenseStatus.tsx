import { useEffect, useState } from 'react';
import { offlineLicense } from './runtime';

export function OfflineLicenseStatus() {
  const [state, setState] = useState(offlineLicense.state);
  useEffect(() => {
    const unsubscribe = offlineLicense.subscribe(() => setState(offlineLicense.state));
    const stop = offlineLicense.start();
    return () => { unsubscribe(); stop(); };
  }, []);
  const label = state.kind === 'valid'
    ? `Licence hors ligne : jusqu’au ${new Date(state.expiresAt!).toLocaleDateString('fr-FR')}`
    : state.kind === 'clock-error' ? 'Horloge modifiée : reconnectez-vous. Édition locale disponible.'
    : state.kind === 'expired' ? 'Licence hors ligne expirée : édition locale disponible. Reconnectez-vous.'
    : 'Édition locale disponible';
  return <span title={label}>{label}</span>;
}
