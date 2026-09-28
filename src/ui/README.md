# Bibliothèque UI Senario

`src/ui/` est la seule source pour les primitives visuelles réutilisables de
l’application. Les écrans métier composent ces primitives ; ils ne recréent
pas leurs boutons, menus, champs, dialogues ou états génériques.

## Règles de contribution

- Utiliser les tokens de `tokens.css` et les alias de `foundations.css`.
- Ajouter une variante à une primitive existante avant de créer un composant
  local semblable.
- Une primitive interactive prévoit au minimum les états repos, survol,
  focus clavier, actif ou sélectionné, désactivé et chargement si l’action est
  asynchrone.
- Un menu ou popover contient son déclencheur et son panneau dans une zone
  interactive continue ; le pointeur peut toujours atteindre le panneau.
- Les menus et popovers du header sont toujours portalisés avec `UiMenu` ou
  `UiPopover` : aucun panneau ne doit participer au flux du header ou modifier
  sa hauteur. Ne pas ajouter d’écouteur global `pointerdown`, `mousedown` ou
  `mouseleave` pour les fermer ; les primitives partagées gèrent déjà le vrai
  clic extérieur, Échap et le retour du focus, y compris à travers un portail.
- Une action uniquement iconique utilise `UiIconButton` avec un `label`
  explicite et, si une aide visuelle est utile, `tooltip` plutôt qu’un attribut
  `title` natif. Le texte du tooltip reste présent pour les technologies
  d’assistance, y compris lorsque le bouton est désactivé.
- Les navigations utilisent `UiTabs`. Choisir l’activation `manual` lorsqu’un
  onglet peut ouvrir une modale, demander un droit ou déclencher un effet ; les
  flèches déplacent alors seulement le focus et Entrée ou Espace active l’onglet.
- Toute progression déterminée ou indéterminée utilise `UiProgress` ; ne pas
  recréer de barre ou de spinner dans un module métier.
- Une recherche compacte avec action d’effacement utilise `UiSearchField`.
- Une saisie monoligne sans libellé visuel interne utilise `UiInput` avec un
  `aria-label` ou un libellé externe explicite ; elle ne recrée pas ses états
  de focus, erreur ou désactivation localement.
- Une zone de commentaire qui suit son contenu utilise `UiTextarea autoGrow` ;
  sa hauteur maximale et son défilement interne restent gérés par la primitive.
- Un panneau de filtres ou d’options non modal utilise `UiPopover` afin de
  conserver le déclencheur, le placement dans la fenêtre, Échap et la fermeture
  extérieure cohérents. Ajouter `ui-option-popover` au panneau et
  `ui-option-list` à sa liste : la hauteur suit alors le contenu et n’est
  limitée que par l’espace réellement disponible dans la fenêtre. Ne jamais
  ajouter une seconde hauteur maximale à une liste imbriquée. Les états
  binaires utilisent `UiSwitch`.
- Un popover qui se ferme à la sortie du pointeur utilise `pointerSafe`. La
  primitive crée le couloir continu entre le déclencheur et le panneau ; aucun
  écran métier ne recrée ce délai ou cette zone de sécurité.
- Garder une cible de 32 px au minimum, ou 44 px lorsque le pointeur est
  tactile.
- Les styles liés à la pagination et au placement du document restent dans
  les modules métier ; ils ne font pas partie de la bibliothèque UI.

## Primitives disponibles

- `UiButton`, `UiIconButton`, `UiInput`, `UiField`, `UiSearchField`, `UiSwitch`
- `UiMenu`, `UiContextMenu`, `UiMenuItem`, `UiMenuSubmenu`, `UiPopover`, `UiDialog`, `UiPanel`
- `UiFeedback`, `UiReadOnlyNotice`, `UiEmptyState`, `UiSelect`, `UiTextarea`, `UiIcon`
- `UiTabs`, `UiTabPanel`, `UiListItem`, `UiProgress`, `UiTooltip`

`UiDialog` gère le portail, le piégeage du focus, la fermeture avec Échap et
le retour du focus au déclencheur. Utiliser `destructive` pour une confirmation
irréversible et les classes de zone (`backdropClassName`, `headerClassName`,
`bodyClassName`, `footerClassName`) uniquement pour adapter un contenu métier,
sans recréer la structure du dialogue.

## Catalogue visuel

En développement, ouvrir **Aide**, puis **Ouvrir le catalogue UI interne**.
Le catalogue expose les composants, leurs états et les fondations sémantiques ;
une nouvelle primitive ou variante doit y être ajoutée dans le même changement.

## Régression visuelle desktop

Lancer l’application avec `npm.cmd run dev -- --host 127.0.0.1`, puis exécuter
`npm.cmd run test:ui` dans un second terminal. Le test pilote une session Edge
isolée aux largeurs desktop 1440, 1024 et 820 px. Il restaure un scénario de
démonstration dans ce profil temporaire, couvre l’éditeur, l’aide, le catalogue,
les raccourcis de texte, le Whiteboard, le Dépouillement et le Découpage
technique, puis vérifie les filtres, la sélection et l’édition de cellules, les
menus de catégories, les erreurs métier typées, les débordements, les zones de
défilement internes, le non-reflow du header, les trajets souris vers les
popovers, les glissements de curseur et la navigation clavier. Les captures sont écrites dans
`outputs/ui-regression/`.

## Prochain chantier

Auditer les interactions média et les contrôles propres aux cellules, puis
valider la hiérarchie de focus et les libellés accessibles avec un facteur de
texte système élevé sur les largeurs desktop. Le produit conserve pour l’instant
son thème sombre unique ; un thème clair sera traité dans une étape séparée.
