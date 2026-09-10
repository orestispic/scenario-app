# Phase 1 — contrats client et interface de développement

## Décisions livrées

- `src/commercial/contracts.ts` décrit la réponse de compte v1 : identité, instantané de droits et règle de compatibilité. Les droits sont une liste de codes et valeurs fournie par le serveur, sans catalogue ni limite métier dans le client.
- `src/commercial/api.ts` est un adaptateur HTTP injectable. Le transport est passé en dépendance ; l’application ne connaît ni fournisseur de paiement, ni SDK d’IA, ni secret.
- `src/commercial/developmentApi.ts` fournit seulement un faux serveur de développement. Son compte `example.invalid` et ses identifiants ne sont pas des données de production. Il ne contient ni tarif ni quota commercial.
- `src/commercial/entitlementCache.ts` sérialise un instantané dans un format versionné. Sa durée est dérivée de `issuedAt` et `offlineValidUntil` reçus du serveur, puis bornée par cette dernière date.
- `src/commercial/compatibility.ts` compare la version distribuée par `VITE_SCENARIO_CLIENT_VERSION` à la version minimale renvoyée par le serveur. Une valeur absente est volontairement considérée comme non compatible.
- Le menu **Compte** ouvre une interface strictement en lecture seule. Elle visualise le faux serveur afin de valider l’intégration sans authentification réelle.

## Contrat inter-dépôts

Le contrat `2026-09-v1` est maintenu en miroir dans `scenario-site-commercial/lib/commercial/contracts.ts`. Les dépôts restent séparés, donc la phase 1 ne crée pas de package publié ni de lien de fichier local fragile. Toute évolution du contrat doit être coordonnée et testée dans les deux worktrees ; un package commun sera évalué seulement quand l’API de phase 2 sera prête.

## Validation effectuée

Les tests Vitest couvrent la validation de réponse injectée, le rejet d’une réponse invalide, l’expiration configurable du cache et le contrôle de version minimale. Le build TypeScript/Vite de l’application et le build du site passent.

## Limites délibérées

Il n’y a pas encore de vraie session, de stockage système de jeton, de route serveur, de RLS ou de connexion Supabase. Le cache d’entitlements est préparé et testé ; son utilisation comme repli de session arrivera avec l’authentification réelle, afin de ne jamais confondre une démonstration locale avec une licence valide.
