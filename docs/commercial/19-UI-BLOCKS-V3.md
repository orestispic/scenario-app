# Application — UI Blocks v3

## Référence et périmètre

La référence est l’archive utilisateur `Senario_UI_Blocks_Design_System.zip`, et non une reconstitution du site inaccessible. Son HTML et son logo sont conservés dans `docs/design-system/source/`.

SHA-256 du HTML original : `e44b0ff61bec9df520ed61884d157f261e52d008835242715a80b895671f0c51`.

`node scripts/import-ui-blocks.mjs` extrait les tokens CSS et les 21 symboles SVG sans redessiner les icônes, copie le logo et conserve les fontes locales. La nouvelle feuille `src/blocksApplication.css` remplace l’import de l’ancien skin. `App.css` conserve la géométrie fonctionnelle (pagination, ancrage, impression) ; l’ancien `designSystem.css` n’est plus chargé.

Les fenêtres métier sont composées des primitives fournies : boutons, champs, menus, listes, panneaux, onglets, cases, interrupteurs, infobulles et commentaires. La disposition et les dimensions des fenêtres suivent leur contenu existant. Le texte des scénarios garde Courier Prime et ses règles de pagination. Aucun contrat commercial, serveur, migration ou droit n’est modifié.

## Deux extensions expressément autorisées

- `UiIcon` : icône Souligné ajoutée à côté des icônes Gras et Italique fournies. Même boîte 24×24, taille affichée 16 px, trait 1,75 et extrémités arrondies. Les 21 autres icônes utilisent le sprite original.
- `UiTextarea` : variante multiligne native du champ fourni. Mêmes couleurs, bordures, focus et états ; quatre lignes initiales, hauteur minimale 96 px, redimensionnement vertical borné à 260 px puis défilement interne. Aucun nouveau style indépendant. Utilisée pour les commentaires, les métadonnées longues et les instructions IA. L’instruction IA est désormais un textarea contrôlé, sans contenu non éditable mélangé à la saisie ; la consigne « réponse uniquement » reste affichée séparément et son comportement est conservé.

## Interactions préservées

`UiSelect` compose le bouton et le menu fournis. Un select natif masqué maintient la valeur et FormData ; les changements conservent les handlers existants. Le déclencheur expose combobox/listbox, les options et la sélection. Navigation par flèches, Début/Fin, Entrée/Espace, Échap et Tab. Échap ferme d’abord le menu sans fermer sa fenêtre. Le menu est placé dans le viewport, se retourne si nécessaire et suit le défilement. Le choix du type de paragraphe conserve contenu et marques ; le focus éditeur est restauré synchroniquement.

Les commentaires restent dans la marge, sans fenêtre de discussion séparée. Une nouvelle carte est repliée par défaut : elle ne montre que le début du commentaire sur une ligne. Un clic l’ouvre avec le texte complet et les actions autorisées ; un second clic la replie. Le placement utilise les hauteurs réelles des cartes pour éviter leur chevauchement. Le fond des ancres utilise l’ambre fourni à 12 %, puis 22 % lorsqu’elles sont actives. Les brouillons concurrents et les ancres perdues restent récupérables.

## Validations locales

Exécutées avec des profils navigateur isolés ; les tests navigateur bloquent les requêtes hébergées ou les remplacent par un Worker en mémoire.

```powershell
$env:SCENARIO_PLAYWRIGHT_PATH='C:/Users/orepi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
$env:SCENARIO_TEST_APP_URL='http://127.0.0.1:1422'
node scripts/import-ui-blocks.mjs
npm.cmd test
npm.cmd run build
node scripts/design-system-ui-e2e.mjs
node scripts/editor-refinement-ui-e2e.mjs
node scripts/verify-browser-overlays.mjs
node --experimental-transform-types scripts/phase10-cloud-ui-e2e.mjs
node --experimental-transform-types scripts/project-metadata-ui-e2e.mjs
git diff --check
```

Résultats : 126 tests unitaires, typecheck et build réussis. Contrôles visuels à 1440/900/390 px, pagination et impression ; commentaires et overlays à 60/100/160 %. Contrôles supplémentaires du multiligne, du clavier, de FormData et de trois comptes synthétiques pour commentaires/pages de garde/lecture seule/conflits. Captures locales dans `outputs/ui-charter`, `outputs/editor-refinement` et `outputs/phase10-cloud-projects.png`.

`node --check` a été exécuté sur les scripts d’import et E2E modifiés. Aucune configuration ESLint n’est disponible dans ce worktree : ne pas présenter ces contrôles comme un lint ESLint. Recherche ciblée des préfixes de clés Stripe/Supabase et de clés privées dans les nouveaux fichiers UI/scripts : aucun résultat. Ce contrôle n’est pas un audit de sécurité exhaustif.

Le build conserve l’avertissement de taille des chunks (>500 ko). Aucune compilation d’installateur Tauri, validation native Windows, publication, notification réelle ni validation externe Supabase/Cloudflare/Stripe n’a été effectuée pour cette refonte. Les validations cloud ci-dessus sont simulées localement.
