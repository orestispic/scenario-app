# Application Scénario commerciale — frontière cliente

## Décision de phase 0

Le dépôt `scenario-app-commercial` reste l’unique application Tauri React/TypeScript multiplateforme. Il cible Windows et macOS à partir d’une base commune ; le dossier `mac` n’est ni modifié ni intégré comme une seconde application.

Cette phase n’ajoute aucun écran commercial, aucune authentification, ni dépendance externe. Elle fixe les frontières qui seront respectées dans les phases suivantes.

## Responsabilités du client

- Édition locale de scénarios et conservation des fichiers existants sans migration destructive.
- Interface de compte, licence, utilisation IA, synchronisation et fonctions Studio après les futures phases.
- Stockage chiffré, via le coffre-fort système quand il sera intégré, des jetons de session et de l’état de licence mis en cache.
- Mise en file locale des mutations cloud ; conflits et restauration restent décidés par le serveur.
- Vérification au démarrage de la configuration publique, de la version minimale et des droits effectifs.

## Frontières non négociables

Le client ne contient jamais de secret OpenAI, Meta, Stripe, Supabase `service_role`, clé de webhook ou clé de chiffrement serveur. Il ne calcule pas lui-même les droits finaux, les quotas, les prix, ni la validité d’un paiement.

Les seuls paramètres publics attendus côté Vite sont documentés dans [`.env.example`](../../.env.example). La valeur de `VITE_SCENARIO_API_BASE_URL` est une URL non secrète ; toutes les décisions commerciales viennent de l’API authentifiée.

## Contrat de droits et tolérance hors ligne

À connexion valide, l’application récupère un document signé/logiquement versionné contenant : `configuration_version`, `entitlement_snapshot_id`, `effective_at`, `offline_valid_until`, droits, quotas applicables et version minimale.

- Le cache est borné à 7 jours après sa dernière validation serveur pour un abonné Auteur IA ou Studio.
- Passé cette échéance, les fonctions payantes et cloud doivent demander une reconnexion, sans rendre les fichiers locaux illisibles.
- Découverte reste utilisable localement dans ses limites ; le serveur reste l’autorité quand une session existe.
- Une version client inférieure à `minimum_supported_version` est bloquée sur les opérations réseau avec un message de mise à jour ; les données locales ne sont jamais supprimées.

Le cache ne doit jamais être traité comme une preuve de paiement. Il sert uniquement à l’expérience hors ligne, avec identifiant d’instantané et date d’expiration contrôlés par le serveur.

## Découpage cible dans l’application

| Module futur | Rôle |
| --- | --- |
| `src/commercial/api` | Client HTTP typé, renouvellement de session, erreurs normalisées. |
| `src/commercial/auth` | État de session, connexion, déconnexion, mot de passe oublié. |
| `src/commercial/entitlements` | Cache de droits, version minimale, garde-fonctions. |
| `src/commercial/sync` | File d’envoi, téléchargement, conflits et versions cloud. |
| `src/commercial/ai` | Soumission de demandes au serveur uniquement, affichage d’usage. |
| `src/commercial/studio` | Versions, comparaison, révision, scènes, rapports et partage. |
| `src/commercial/instagram` | Centre privé, brouillons et statut des publications futures. |

Ces modules ne seront créés qu’au fur et à mesure des phases ; aucune importation n’est prévue vers les clés des fournisseurs.

## Critères de compatibilité

- Les fichiers `.scenario` actuels et les flux d’export existants restent supportés.
- Les nouvelles données commerciales sont séparées de la représentation du document local.
- Les imports/exports FDX et Fountain, le partage lecture et les fonctions Studio sont des capacités gouvernées par le serveur, pas des suppositions du client.
- Les réponses API sont validées à l’entrée et le client ne fait confiance à aucun flag fourni par son interface.
