# Refonte de l’application — charte Senario UI v1

## Périmètre

Application commerciale uniquement, branche `codex/commercial-v1`. Référence :
planche utilisateur `UI design/Senario-UI-Charte-4K.png` et charte du site commercial
`docs/commercial/20-SITE-MULTIPAGE-DA.md` dans le worktree du site.
Aucun changement du site, du backend, des contrats ou des migrations. Aucun dépôt
source, branche main ni dossier mac modifié. Aucun push ni déploiement.

## Système visuel

`src/designSystem.css` centralise les tokens de la charte et l’habillage écran.
Il est chargé après les styles de structure historiques. Les dimensions A4,
marges, interligne et styles des paragraphes du moteur existant sont conservés.
Le mode clair et son ancien raccourci sont retirés : une préférence claire déjà
enregistrée est ignorée, sans supprimer les autres préférences ou les projets.

- Fond #080B10, panneaux #11161E, flottants #181F29, survol #1B2430,
  sélection #132B44, bordures #27313E.
- Texte #EDF2F7, secondaire #9AA7B7. Actions/focus #2A86E6,
  secondaire/pressé #1968B9, IA et avertissements #E5B33E.
- Succès #4CC38A, erreur #EF6674, information #62A8F5.
- Les boutons principaux utilisent le bleu secondaire en fond avec bordure
  primaire, puis le bleu primaire au survol. La distinction sélection/action,
  l’état désactivé et le focus clavier restent visibles.
- Inter variable pour l’interface ; Courier Prime régulier, gras, italique et
  gras italique pour le scénario affiché et sa page de garde. Polices locales
  avec licences OFL dans `public/fonts`, sans requête tierce à l’exécution.
  Inter/régulier repris des assets du site ; variantes Courier Prime issues du
  dépôt officiel google/fonts, répertoire `ofl/courierprime`.
- Barre principale 48 px minimum, seconde barre 40 px : titre, état local/cloud,
  page et zoom. Les menus restent près de leur bouton, sans modifier les calculs
  des overlays liés au curseur. Retour à 100 % via le bouton de zoom.
- Contrôles 34/36 px, rayons 6/8/12 px, focus 2 px et décalage 2 px,
  scrollbars discrètes, transitions de 120 ms désactivées en mouvement réduit.
- Fenêtres compte, cloud, commentaires, recherche, raccourcis, IA, aide et PDF
  harmonisées ; commentaires bleus et bouton de bulle SVG 1,6 px.
- Chrome natif Tauri sombre et fond initial sombre dans les deux configurations
  commerciales, sans assouplissement de CSP ni changement d’identifiant.

L’organisation fonctionnelle de l’éditeur reste en place. Ce lot ne crée pas de
nouveau panneau métier ni de nouvelle autorisation. Le slogan de marque reste
« la meilleure page blanche » ; il n’est pas répété dans la zone d’écriture.

## Préservation de l’édition

Le chargement initial et les chargements ultérieurs de polices déclenchent une
repagination, avec nettoyage des listeners au démontage. Le zoom par défaut est
corrigé : l’absence de préférence ne doit pas devenir `Number(null) = 0`, borné à
60 %. Les zooms explicitement enregistrés restent respectés.

Les formats `.scenario`, les données de garde/commentaires, la collaboration,
les sessions/coffres et la récupération locale ne sont pas modifiés. Aucun texte
ni jeton supplémentaire n’est enregistré dans localStorage. Les nouvelles polices
sont un choix d’affichage : l’export PDF garde ses polices Unicode embarquées et
ses règles existantes, sans promesse d’identité pixel à pixel avec l’écran.
L’impression navigateur conserve une page blanche, un texte noir et masque les
outils d’édition. Les parcours natifs ouvrir/enregistrer/exporter sur un poste
Windows installé restent à vérifier manuellement ; les tests navigateur ne les
remplacent pas.

## Recette locale — 13 septembre 2026

- 123 tests unitaires, 28 fichiers : réussis.
- Rust : 3 réussis ; 1 test explicite du coffre-fort système ignoré comme prévu.
- TypeScript et build Vite : réussis ; avertissement existant de bundles > 500 ko.
- Build Tauri/NSIS bêta : réussi. Avertissement informatif du linker Windows.
- E2E charte : 1440, 900 et 390 px ; préférence claire ancienne, zoom initial,
  polices, palette calculée, navigation accessible, focus clavier, page de garde,
  compte, commentaires, recherche, raccourcis, IA, aide et styles d’impression.
  Un texte long paginé est comparé après retrait des seuls marqueurs visuels
  `(SUITE)`, qui ne font pas partie du document.
- E2E overlays : menu contextuel et SmartType aux zooms 60, 100, 160 %.
- E2E cloud : projet privé, synchronisation, partage, ouverture collaborative,
  fenêtre étroite et absence de contenu/session dans localStorage.
- E2E à trois comptes locaux : fusion des champs de garde, commentaires/réponses,
  modification, résolution/réouverture, ancre perdue conservée, suppression,
  convergence et lecteur en lecture seule. Libellé « Voir le passage » non tronqué.
- Captures inspectées dans `outputs/ui-charter`, `outputs/ui-charter-shared-comments.png`
  et `outputs/phase10-cloud-projects.png` (artefacts locaux non committés).
- Contrôle de secrets/configuration serveur/stockage de jetons : 84 sources OK.
- Lint ciblé et `git diff --check` : succès.

Commandes exécutées depuis le worktree application, sauf indication :

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run build:beta
cargo test --manifest-path src-tauri/Cargo.toml
node ../scenario-site-commercial/node_modules/oxlint/bin/oxlint src/App.tsx src/main.tsx src/commercial/AccountLicensePanel.tsx scripts/design-system-ui-e2e.mjs scripts/project-metadata-ui-e2e.mjs scripts/phase10-cloud-ui-e2e.mjs scripts/verify-browser-overlays.mjs
git diff --check

# Serveur de recette séparé ; ne charge pas les identifiants phase9.
$env:VITE_SCENARIO_CLIENT_VERSION='0.1.7'
npm.cmd run dev -- --host 127.0.0.1 --port 1422

# Dans un autre terminal. Le chemin dépend du runtime local disponible.
$env:SCENARIO_PLAYWRIGHT_PATH='C:/Users/orepi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
$env:SCENARIO_TEST_APP_URL='http://127.0.0.1:1422'
node scripts/design-system-ui-e2e.mjs
node scripts/verify-browser-overlays.mjs
node --experimental-transform-types scripts/project-metadata-ui-e2e.mjs
node --experimental-transform-types scripts/phase10-cloud-ui-e2e.mjs

# Depuis le worktree site, lecture seule des sources application :
node scripts/security-check.mjs --app
```

Les premiers essais locaux ont révélé des défauts de recette (origine 1422 non
autorisée dans le faux Worker, version cliente absente), puis des défauts visuels
(priorité CSS, garde hors écran, largeur d’un bouton de commentaire). Ils ont été
corrigés et les recettes relancées avec succès. Le refus CORS et de version n’a
pas été désactivé : le faux Worker reçoit uniquement l’origine locale de recette.
Le premier build sandboxé a été bloqué par les permissions esbuild, puis exécuté
avec l’accès local nécessaire. Le serveur 1420 existant n’a pas été interrompu.

## Limites de livraison

Toutes les recettes collaboratives de ce lot utilisent un Worker en mémoire et
des profils synthétiques ; les autres requêtes externes sont bloquées. Elles ne
constituent pas une nouvelle validation réelle Supabase, Stripe ou Cloudflare.
Pas d’appel IA, d’e-mail, de compte, de paiement ni de ressource externe créé.

Installateur créé localement :
`src-tauri/target/release/bundle/nsis/senario Beta_0.1.7_x64-setup.exe`.
Il n’est ni installé automatiquement ni publié. La signature Windows et la
validation d’installation sur machine propre restent les blocages déjà documentés
en phase 12. Aucun canal de mise à jour ni téléchargement public n’est activé.
