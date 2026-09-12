# Phase 10 — Projets cloud privés et partagés

## Parcours livré

Le bouton **Projets cloud** ouvre une fenêtre indépendante de Compte et licence.
Un projet est un fichier `.scenario` cloud, pas une équipe globale. Nouveau projet
ou Ajouter le scénario ouvert crée une version privée ; Gérer le partage prépare
son Studio technique, puis permet d'inviter un Éditeur ou un Lecteur. Le
destinataire accepte dans cette même fenêtre, sans notification externe ni lien
contenant un secret. Les membres d'un projet ne voient pas les autres projets.

L'ouverture d'un projet partagé active automatiquement le client collaboratif
existant. Fermer la fenêtre ne ferme pas la collaboration. Le bandeau de menu
affiche le projet, les présents, la synchronisation, la reconnexion ou un conflit.
La fenêtre propose recherche, filtres privé/partagé/corbeille, membres, invitations,
historique, téléchargement des versions et copies locales. Le Studio de
démonstration existant conserve ses identifiants et ses membres.

## Persistance et protection du travail

- Le serveur choisit `realtimeBaseVersionId` au premier partage : dernière version
  privée, immuable ensuite. Cela évite de repartir du premier fichier vide.
  Les anciens Studios conservent leur racine historique pour rejouer leur journal.
- Le runtime indépendant de React conserve le fichier ouvert avant remplacement.
  IndexedDB `scenario-cloud-working-copies-v1`, clé compte/projet, conserve des
  fichiers `.scenario` et des sauvegardes indépendantes. Aucun jeton, ticket,
  opération brute ou URL temporaire n'y est écrit. Aucun contenu cloud nouveau
  n'est écrit dans localStorage. Les exports existants restent disponibles.
- Un projet privé est sauvegardé après 1,5 s sans frappe ; vérification périodique
  toutes les 10 s. Échec réseau : nouvelle tentative après 30 s, même clé et mêmes
  octets pour une réponse incertaine. Une édition ultérieure forme une autre
  requête. Les parents explicites et le serveur détectent la concurrence.
- Une copie non synchronisée et une version distante différente provoquent un
  choix explicite. Le fichier local n'est jamais automatiquement remplacé.
  Télécharger ma copie / Continuer comme copie locale restent les sorties sûres.
- Le cache n'autorise aucune requête serveur. Déconnexion : canaux fermés,
  opérations authentifiées annulées, état collaboratif en mémoire effacé ; les
  fichiers locaux restent récupérables. Une révocation suspend l'édition partagée.
- Un ancien snapshot partagé ne remplace pas directement un journal collaboratif
  actif. Il est téléchargeable comme fichier indépendant. La restauration v6
  reste proposée pour les projets privés non ouverts.

## Contrats et limites explicites

Contrat v9 distinct (phase produit 10), sans modification des contrats v1 à v8.
Le serveur fournit rôles, droit de partager, membres, canal et base. Aucun prix,
quota ou modèle payant n'a été ajouté au client.

La collaboration réutilise le protocole v8 au niveau des blocs : conflits dans un
même bloc explicites, pas de nouvelle fusion caractère par caractère. Le texte
est collaboratif ; couverture, commentaires et métadonnées supplémentaires
restent conservés dans le fichier local et ne sont pas édités en direct à
plusieurs. Les projets privés sauvegardent le fichier complet. Cette limite est
affichée dans la fenêtre de partage.

IndexedDB n'est pas un coffre chiffré contre un utilisateur de la machine/XSS,
ni une sauvegarde externe : un effacement du profil navigateur l'efface. Les
copies sont conservées sans purge automatique ; exporter les fichiers importants.
Une page rechargée perd volontairement sa session navigateur en mémoire. Le
coffre système Tauri reste celui de phase 4, inchangé.

Les modifications locales hors ligne survivent à la fermeture via une copie de
fichier ; le rechargement ne rejoue pas aveuglément des opérations potentiellement
obsolètes. La résolution des conflits nécessitant une décision humaine n'est
pas automatisée.

## Vérifications exécutées avant déploiement

105 tests Vitest, typecheck, build mode phase9 réussis. Test Edge isolé : création
privée, sauvegarde, partage après édition, conservation du texte, connexion
automatique, absence de contenu/jetons dans localStorage, fenêtre à 640 px. Test
des menus existants à 60/100/160 % réussi. Aucun onglet utilisateur manipulé.
Rust : 3 tests réussis ; test explicite de coffre système ignoré par défaut.
Lint ciblé et scan de sécurité réussis. Avertissement existant sur la taille des
chunks JavaScript ; aucune publication de l'application ni signature d'installateur.

Commandes depuis ce worktree :

```powershell
npm.cmd test -- --reporter=dot
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run build -- --mode phase9
..\scenario-site-commercial\node_modules\.bin\oxlint.cmd src/commercial/CloudProjectsPanel.tsx src/commercial/cloudProjectRuntime.ts src/commercial/cloudProjectRuntime.test.ts src/commercial/cloudProjectStore.ts src/commercial/contractsV9.ts src/commercial/authenticatedApi.ts src/commercial/AccountLicensePanel.tsx src/commercial/studioBase.ts scripts/phase10-cloud-ui-e2e.mjs
$env:SCENARIO_PLAYWRIGHT_PATH='C:\Users\orepi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
node --experimental-transform-types scripts/phase10-cloud-ui-e2e.mjs
node scripts/verify-browser-overlays.mjs
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline
git diff --check
```

Les résultats réellement hébergés sont consignés dans le document phase 10 du
worktree plateforme. Les tests Edge ci-dessus interceptent l'API vers un faux
serveur local : ils ne sont pas une preuve Cloudflare/Supabase réelle.
