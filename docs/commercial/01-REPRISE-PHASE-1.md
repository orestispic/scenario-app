# Reprise — phase 1 côté application

## Point de départ vérifié

Cette branche est `codex/commercial-v1`, créée depuis `scenario-app/main`. La phase 0 n’a ajouté que des documents et un fichier `.env.example` : l’application, son Rust Tauri et ses dépendances n’ont pas été modifiés.

La source de vérité commerciale (offres, modèle de données, API et sécurité) se trouve dans le worktree frère `scenario-site-commercial/docs/commercial`. Ne dupliquez pas les prix ou limites dans TypeScript : récupérez-les à travers l’API quand elle existera.

## Première tranche recommandée

1. Créer les types sans logique métier : session, `EntitlementSnapshot`, `OfferConfiguration`, `ClientCompatibility` et erreurs API.
2. Ajouter un adaptateur HTTP injectable et une implémentation simulée uniquement pour les tests d’interface.
3. Ajouter un stockage de cache d’entitlements versionné, sans jeton ni secret dans `localStorage` non protégé.
4. Afficher un état compte/licence en lecture seule derrière un drapeau de fonctionnalité local de développement.
5. Ajouter les tests unitaires de désérialisation, expiration des 7 jours et garde de version minimale.

## À ne pas faire en phase 1

- Aucun appel direct à OpenAI, Stripe, Meta ou Supabase depuis le client.
- Aucune migration automatique ou irréversible des documents utilisateurs.
- Aucun prix, quota ou nombre d’appareils codé en dur.
- Pas de publication, de push ou de modification de `main`.

## Validation avant le prochain commit

Exécuter `npm.cmd test -- --run` et `npm.cmd run build`, puis contrôler que seuls les fichiers commerciaux prévus changent. La connexion à une API réelle reste pour une phase où le serveur et ses secrets sont disponibles.
