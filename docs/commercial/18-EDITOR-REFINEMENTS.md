# Ajustements de l’éditeur — 13 septembre 2026

Implémentation limitée au worktree commercial de l’application. Aucun changement
de contrat, de serveur, de migration ou de configuration distante. Aucun déploiement.

## Comportements

- AS → APRÈS est retiré des raccourcis livrés et des anciens raccourcis natifs
  enregistrés ; les raccourcis explicitement personnalisés sont conservés.
- Gras, italique et souligné conservent la sélection lors du clic. Le menu de type
  modifie uniquement le paragraphe du curseur, sans réécriture de texte ou de marques.
  La commande Tiptap utilise sa transaction fournie, sans double dispatch.
- Aucun placeholder pour un titre de scène vide. SmartType utilise le même bleu
  au survol et à la sélection.
- Les notes sont positionnées dans une marge de 228 px, séparée de la feuille de
  24 px, dans le même conteneur défilant. L’ancrage utilise le début du passage.
  Le placement est trié par position puis identifiant ; chaque carte est décalée
  sous la précédente si nécessaire, avec 8 px d’espace. Les hauteurs réelles sont
  remesurées à l’édition, au zoom et au redimensionnement. Pas de compression ou
  de chevauchement : le conteneur s’allonge et reste défilable.
- Le corps entier d’une note est un bouton. Ses actions Modifier/Supprimer sont
  affichées sur place. Aucun panneau de discussion séparé n’est rendu.
- Texte annoté jaune discret, plus marqué quand actif ; cliquer une note place
  seulement un curseur logique, sans sélectionner en bleu le passage.
- Les anciennes réponses et les notes résolues restent visibles, les ancres
  perdues restent récupérables. Une modification distante pendant la saisie
  conserve le brouillon et bloque son écrasement silencieux. Les contrôles cloud
  existants continuent d’imposer la lecture seule aux viewers.
- Statistiques fixes sous la zone défilante : mots, durée estimée, pages, scènes
  non vides, décors distincts. La durée est indicative (environ une minute par
  page de scénario, hors page de garde), pas une mesure de lecture. Le total de
  pages inclut la page de garde. Les décors sont déduits des titres en normalisant
  INT/EXT, casse, espaces et moments usuels ; les formulations libres peuvent
  compter comme des décors différents.
- Connexion compacte : titre, champs, mot de passe oublié, bouton bleu, lien de
  création de compte. Authentification et coffre-fort inchangés.

## Validations locales effectuées

Dans `scenario-app-commercial`, serveur de test isolé :

```powershell
$env:VITE_SCENARIO_CLIENT_VERSION='0.1.7'
npm.cmd run dev -- --host 127.0.0.1 --port 1422
$env:SCENARIO_TEST_APP_URL='http://127.0.0.1:1422'
$env:SCENARIO_PLAYWRIGHT_PATH='C:/Users/orepi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
node scripts/editor-refinement-ui-e2e.mjs
node scripts/design-system-ui-e2e.mjs
node scripts/verify-browser-overlays.mjs
node --experimental-transform-types scripts/project-metadata-ui-e2e.mjs
node --experimental-transform-types scripts/phase10-cloud-ui-e2e.mjs
npm.cmd run build
npm.cmd test
node ../scenario-site-commercial/node_modules/oxlint/bin/oxlint src/App.tsx src/commercial/AccountLicensePanel.tsx src/editor/CommentMargin.tsx src/editor/documentStatistics.ts src/editor/extensions/ScenarioParagraph.ts
git diff --check
```

Dans le worktree site, contrôle en lecture seule :

```powershell
node scripts/security-check.mjs --app
```

Résultats : 126 tests unitaires réussis, build/typecheck réussis, lint ciblé sans
avertissement, contrôle de sécurité de 87 fichiers réussi. E2E visuels à 60/100/160 %,
mise en page à 1440/900/390 px, impression et trois comptes synthétiques réussis.
Captures locales sous `outputs/editor-refinement` et `outputs/ui-charter`.
Les tests ont révélé puis couvert les corrections de sélection et double dispatch.
Les tests cloud utilisent un Worker en mémoire et ne prouvent pas une validation
Supabase/Cloudflare réelle. Aucun e-mail réel envoyé. Aucun installateur reconstruit.
Le build conserve l’avertissement existant concernant les chunks de plus de 500 kB.
