import type { AccountOverview } from "./contracts";
import type { ClientCompatibilityState } from "./compatibility";

interface AccountLicensePanelProps {
  overview: AccountOverview | null;
  status: "loading" | "ready" | "error";
  compatibility: ClientCompatibilityState | null;
  onClose(): void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date indisponible"
    : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AccountLicensePanel({ overview, status, compatibility, onClose }: AccountLicensePanelProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="account-license-panel" role="dialog" aria-modal="true" aria-label="Compte et licence" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Compte et licence</h2>
            <p>Données de développement simulées, en lecture seule.</p>
          </div>
          <button className="panel-close-button" type="button" aria-label="Fermer" onClick={onClose}>×</button>
        </header>

        {status === "loading" && <p className="account-license-loading">Chargement du compte…</p>}
        {status === "error" && <p className="account-license-error">Le faux serveur de développement ne répond pas.</p>}
        {status === "ready" && overview && (
          <div className="account-license-details">
            <dl>
              <div><dt>Compte</dt><dd>{overview.account.displayName ?? overview.account.email}</dd></div>
              <div><dt>Adresse</dt><dd>{overview.account.email}</dd></div>
              <div><dt>Configuration reçue</dt><dd>{overview.entitlementSnapshot.configurationVersion}</dd></div>
              <div><dt>Instantané de droits</dt><dd>{overview.entitlementSnapshot.id}</dd></div>
              <div><dt>Accès hors ligne jusqu’au</dt><dd>{formatDate(overview.entitlementSnapshot.offlineValidUntil)}</dd></div>
              <div><dt>Compatibilité</dt><dd>{compatibility === "compatible" ? "Version compatible" : "Mise à jour à vérifier"}</dd></div>
            </dl>
            <p>Les droits et leur durée sont fournis par le serveur. Aucun tarif, quota ou droit commercial n’est enregistré dans cette interface.</p>
          </div>
        )}
      </section>
    </div>
  );
}
