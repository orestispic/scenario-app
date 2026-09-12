# Complément phase 10 — Commentaires et premières pages

Les projets privés conservent tout le fichier. Pour les projets partagés,
commentaires, réponses, état résolu et douze champs de page de garde sont
synchronisés via le contrat distinct v10, en complément du texte v8.
Le bouton **Commentaires** retrouve aussi les discussions résolues ou dont
le passage a disparu. La première page reste le modèle existant : titre,
crédits, production, date, contact… Pas de nouvel éditeur de pages arbitraires.

Envoi après 800 ms, réception au polling de 4 s. Champs/fils distincts fusionnent ;
un même champ/fil modifié simultanément crée un conflit explicite. La copie locale
complète reste téléchargeable depuis Projets cloud. Les anciennes versions sont
immuables. Un brouillon ouvert n'est pas remplacé par une mise à jour distante.
Deux réponses simultanées au même fil peuvent demander une résolution humaine.
Les lecteurs consultent sans pouvoir annoter ni modifier la garde ; contrôle
serveur systématique. Modifier le premier message conserve toutes ses réponses.

Les marques de commentaire sont des projections visuelles, pas des opérations v8.
Une ancre absente/ambiguë devient « Passage introuvable », le fil reste visible.
Suppression confirmée compatible navigateur/Tauri ; nouveaux IDs UUID.

Les snapshots comprennent texte, garde, commentaires et révision. Les copies
IndexedDB sont isolées par compte/projet, sans jetons, URL ou opération brute.
Aucun contenu cloud dans localStorage. Fermeture/déconnexion annule les requêtes ;
les fichiers locaux restent récupérables. Aucun prix/droit/quota commercial client.

116 tests Vitest réussis. Edge isolé, trois comptes : couverture concurrente,
viewer, commentaire/réponse/édition sans perte, résolution/réouverture, ancre
perdue, suppression convergente, aucun contenu/jeton dans localStorage ni erreur
navigateur. Le test intercepte l'API vers un serveur local : pas une preuve cloud.
Build phase9/typecheck OK. Rust : 3 réussites, 1 coffre natif ignoré. Lint ciblé
et scan de secrets OK ; avertissement de bundles lourds existant. Résultats
SQL/API hébergés : document plateforme `17-PROJECT-COMMENTS-FRONT-MATTER.md`.

Commandes application :

```powershell
npm.cmd test -- --reporter=dot
npx.cmd tsc --noEmit
npm.cmd run build -- --mode phase9
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline
..\scenario-site-commercial\node_modules\.bin\oxlint.cmd src/App.tsx src/editor/comments.ts src/editor/ProjectCommentsPanel.tsx src/commercial/projectMetadataClient.ts src/commercial/projectMetadataClient.test.ts src/commercial/contractsV10.ts src/commercial/cloudProjectRuntime.ts src/commercial/cloudProjectRuntime.test.ts src/commercial/collaborationClient.ts src/commercial/authenticatedApi.ts src/commercial/CloudProjectsPanel.tsx scripts/project-metadata-ui-e2e.mjs scripts/phase10-cloud-ui-e2e.mjs
$env:SCENARIO_PLAYWRIGHT_PATH='C:\Users\orepi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
node --experimental-transform-types scripts/project-metadata-ui-e2e.mjs
git diff --check
```

Recharger l'application après livraison pour obtenir le nouveau client.
Aucune manipulation ni partage d'identifiants nécessaire pendant cette intervention.

## Livraison vérifiée

Application `50a077b`, Worker corrigé `9a0d2fc` déployé uniquement en préproduction
(version Cloudflare `cf8f3ef8-f4ff-4631-ae05-bfaf85d99462`). Validation API réelle
réussie sur Supabase/Cloudflare avec trois comptes : garde et commentaires,
concurrence, réponses/replay, viewer/révocation, texte collaboratif et snapshot
privé complet avec parent et checksum. Un défaut historique du replay de snapshot
a été détecté puis corrigé avant cette réussite. Aucun objet historique réécrit.

Deux projets synthétiques de validation sont en corbeille, récupérables ; aucun
scénario utilisateur modifié. Test navigateur historique relancé avec succès :
`node --experimental-transform-types scripts/phase10-cloud-ui-e2e.mjs`.
Pas de publication production ni de push Git. Restent hors de cette validation :
charge prolongée, installateur signé et test interactif du coffre système.
