# Phase 7 — interface Studio

La section Studio du panneau Compte et licence utilise exclusivement l’API authentifiée v7. Elle affiche chargement, absence de Studio, indisponibilité, invitation expirée/révoquée/déjà consommée et conflit d’idempotence. Un owner peut demander une invitation, un changement de rôle ou un retrait ; l’interface rappelle que la décision appartient au serveur.

Dans le mode `local-test`, le faux fournisseur de notifications rend le jeton d’action au seul compte synthétique destinataire. React le conserve uniquement en mémoire jusqu’à acceptation/refus ou démontage. Aucun jeton d’invitation, jeton de session, contenu distant ou URL temporaire n’est écrit dans `localStorage`. Le seul stockage local de synchronisation reste la file v6, qui ne contient pas le document et est supprimée à la déconnexion.

La déconnexion annule d’abord les requêtes authentifiées en vol, retire la section Studio, invalide la session et son coffre-fort, puis efface les caches de droits et la file cloud. Le démontage de la section Studio abandonne son état en mémoire ; les scénarios `.scenario` locaux restent intacts. Le cache hors ligne masque volontairement la section Studio et n’autorise aucune lecture ou mutation distante.

Le client v7 n’implémente pas encore la présence ou l’édition temps réel. Le rattrapage d’événements est exposé par l’adaptateur API pour Phase 8 ; les versions concurrentes continuent d’utiliser le parent explicite et le conflit v6.

Validation locale :

```powershell
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```
