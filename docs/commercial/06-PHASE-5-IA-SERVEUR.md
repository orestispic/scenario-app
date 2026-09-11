# Phase 5 — client IA via API commerciale

Lire aussi `scenario-site-commercial/docs/commercial/09-PHASE-5-IA-QUOTAS.md`, qui décrit les contrôles serveur, la réservation atomique, la confidentialité et les validations externes.

Les fonctions publiques `runAiPrompt`, `translateScenario` et l’import PDF sont conservées, mais elles passent désormais par `AuthenticatedCommercialApi`. L’application n’appelle plus directement un fournisseur IA. Les commandes Tauri de fournisseur, la clé et le modèle ont été retirés ; à la première lecture, une ancienne configuration locale est réécrite pour ne conserver que les presets de prompts créés par l’utilisateur. La dépendance HTTP directe correspondante est supprimée.

Le contrat miroir `contractsV5.ts` valide les réponses `2026-09-v5`. Le contexte envoyé comprend seulement access token en mémoire, version cliente, plateforme, empreinte d’appareil et clé d’idempotence. La clé est conservée uniquement en mémoire pour réutiliser la même demande après une panne réseau ou une réponse incertaine. Elle est supprimée après un résultat effectivement reçu. Le serveur décide du fournisseur, des modèles, droits, quotas et règles commerciales.

Le refresh token reste dans le coffre-fort système de phase 4 et l’access token uniquement en mémoire. Aucun jeton n’est écrit dans `localStorage`. L’identifiant aléatoire d’appareil et le cache d’entitlements peuvent y rester ; ils ne sont ni des jetons ni une autorisation IA. Chaque opération nécessite une session réseau renouvelable et un appareil actif validé par le serveur. Une session expirée, un cache hors ligne valide ou un champ d’élévation client ne permet jamais un appel IA.

L’écran de configuration ne demande plus de clé ni de modèle et explique la dépendance au compte/appareil. Les presets locaux restent éditables. Les formats de documents et exports existants restent inchangés.

Validations locales : tests des contrats et headers/idempotence, suite Vitest complète, build Vite/TypeScript, compilation et tests Rust, recherche de secrets/direct-provider et lint/format ciblés depuis le worktree site. Aucun appel IA réel, déploiement ou publication n’est effectué. Une réponse fournisseur réussie mais perdue côté réseau est visible comme `succeeded` à la réconciliation, sans contenu restitué : l’utilisateur doit relancer avec une nouvelle demande s’il souhaite régénérer le résultat, ce qui constitue une nouvelle consommation explicite.
