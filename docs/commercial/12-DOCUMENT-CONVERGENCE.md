# Menus navigateur et convergence des documents Studio

## Défauts reproduits dans le code

Les coordonnées DOM et les événements de souris étaient multipliés une deuxième
fois par le zoom de la feuille. Les menus contextuels, SmartType et les repères
IA/commentaires mélangent alors deux espaces de coordonnées. La conversion
soustrait désormais uniquement l'origine du conteneur d'overlay. Le hit-test IA
utilise également les rectangles du viewport, sans double zoom.

La stabilité de la connexion ne prouvait pas la convergence : chaque onglet
rejouait des changements sur SON fichier local sans charger la base cloud commune.
Les paragraphes locaux non partagés restaient donc présents. L'ancien adaptateur
Tiptap remplaçait les blocs existants sans respecter leur nouvelle position ;
le diff ignorait les déplacements sans changement de texte, et les échos des
propres opérations ne rétablissaient pas un ordre commun après des insertions
optimistes concurrentes.

## Initialisation et édition

Rejoindre exige une action explicite, un téléchargement proposé du fichier
`.scenario` local complet (couverture et commentaires inclus), puis la
confirmation par l'utilisateur qu'il en a conservé une copie. Le corps local
n'est pas fusionné silencieusement dans le Studio. Une modification pendant la
recherche de base annule la demande de connexion. Les requêtes de base sont
annulables et bornées à huit secondes et 4 Mio, avec vérification de taille et
SHA-256 à partir des métadonnées authentifiées. Aucun bearer n'est transmis à
l'URL objet. Rien n'est écrit dans localStorage par ce parcours.

Le client choisit la version racine immuable commune du scénario, pas un snapshot
récent susceptible de changer entre deux connexions. Les anciens fichiers de
fixture `blocks` sont acceptés ; un vrai fichier utilise `content`. Les blocs de
base dépourvus d'identifiant reçoivent un ID déterministe lié à la version et à
l'index. Les doublons d'ID sont refusés. Les mutations anciennes reprennent
l'identité de leur enveloppe, au lieu de générer un nouvel ID dans chaque éditeur.

Pendant le chargement et les pages initiales, le fichier local est conservé et
l'édition verrouillée. Il n'est remplacé qu'après rattrapage complet. Son chemin
local est détaché pour qu'un enregistrement du Studio ne remplace pas le fichier
initial. Une réponse tardive après arrêt ne remplace pas le document ouvert.

La projection part de cette base commune et des registres LWW v8 gagnants ordonnés
par `(logicalClock, actorId, operationId)`, comme la projection de snapshot serveur.
Les opérations locales non encore observées dans le journal sont une surcouche
optimiste conservée jusqu'à leur écho. Les échos, doublons et tombstones participent
donc à une même projection. Une collision avec un bloc local non confirmé reste
un conflit explicite, jamais une suppression silencieuse. Le nombre de registres
en mémoire est borné ; un dépassement demande une récupération.

L'adaptateur produit une transaction ProseMirror minimale avec position correcte,
mappage de sélection et `addToHistory=false`. Un changement distant ne déclenche
plus le convertisseur local de début de scène. Un schéma incompatible bloque la
collaboration avec récupération, sans boucle réseau ni remplacement du texte local.
Les contrats publics v1 à v8 sont inchangés.

## Compatibilité du téléchargement

Le test réel a découvert un troisième défaut : le Worker déployé compose les
URLs signées Supabase sans `/storage/v1`, produisant une réponse 404. Une
compatibilité cliente limitée aux hôtes HTTPS `*.supabase.co` et au chemin
`/object/sign/` remet ce préfixe, sans changer l'origine, le chemin objet signé ni
le token. Le SHA-256 du fichier téléchargé reste obligatoire. Les URLs correctes
et celles d'autres fournisseurs restent inchangées.

La correction serveur est préparée séparément dans le worktree plateforme, mais
**pas déployée pendant cette intervention**. Le client fonctionne avec le Worker
déjà hébergé grâce à cette compatibilité ; aucune migration supplémentaire.

## Validations réalisées

- `npm.cmd test -- --run` : 96 tests, 24 fichiers, tous réussis.
- `npm.cmd run build -- --mode phase9` et `tsc --noEmit` : réussis ; avertissements
  préexistants sur les tailles de bundles.
- Lint ciblé des nouveaux modules/tests/scripts avec le binaire oxlint du worktree
  plateforme ; scan `node scripts/security-check.mjs --app` depuis la plateforme.
- `node scripts/verify-browser-overlays.mjs` : vrai Edge headless, profils jetables,
  menus contextuels et SmartType alignés au pointeur/caret à 60 %, 100 % et 160 %.
  Aucun accès aux onglets existants ; requêtes externes bloquées. Fournir le chemin
  du paquet Playwright installé via `SCENARIO_PLAYWRIGHT_PATH` si non résolu.
- Tests locaux : trois états ProseMirror avec contenus initiaux différents,
  insertions concurrentes, retry incertain, doublons/hors ordre, même document final,
  viewer et reconnexion ; déplacements sans changement de texte, paragraphes
  vides, tombstones, document invalide et réponse tardive après arrêt.
- `node scripts/realtime-soak.mjs 60 --sequential` : reconstruction authentifiée
  réelle, successivement avec les trois comptes existants de préproduction ;
  documents JSON identiques et zéro erreur. Le contenu n'est pas journalisé et
  aucune opération d'édition n'est envoyée.
- Après déploiement du correctif serveur `035da9e`,
  `node scripts/realtime-owner-editor-e2e.mjs` connecte réellement Owner et Editor,
  ajoute simultanément deux paragraphes synthétiques vides portant des IDs réservés,
  attend les deux opérations et compare les JSON complets. Il retire ensuite tous
  ses blocs visibles par tombstones et exige une seconde convergence. Aucun texte
  n'est injecté ou journalisé ; l'audit append-only reste conservé.
- `git diff --check` dans les deux worktrees.

Les premiers passages hébergés de 60 secondes ont échoué sur le 404, puis un
passage concurrent a reçu deux `rate_limited` à la fin malgré des connexions et
chargements corrects. Les trois lecteurs du diagnostic s'ajoutaient aux onglets
interactifs derrière la même adresse IP ; l'ingress borne les lectures par route
et IP. Les protections serveur n'ont pas été relevées ni contournées. Le passage
séquentiel évite cette concurrence du diagnostic, mais ne constitue PAS une
nouvelle preuve de stabilité simultanée de longue durée. Le précédent succès de
cinq minutes appartient à la correction de connexion antérieure.

## Limites et reprise utilisateur

Les métadonnées (couverture, commentaires, titre) ne sont pas collaboratives en
v8 ; la convergence testée concerne le corps du scénario. La base racine et un
journal encore rejouable sont nécessaires : une racine indisponible ou un curseur
compacté trop ancien demandent récupération, sans inventer un document vide.
La double écriture canal/SQL et les conflits de même bloc restent les limites
décrites dans le compte rendu précédent. L'exploitation derrière une même IP
avec de nombreux onglets nécessite encore un dimensionnement de l'ingress.

Pour chaque onglet : arrêter la collaboration, démarrer, télécharger la copie
locale, vérifier qu'elle est conservée, puis rejoindre le scénario partagé. Ne
pas recharger la page tant que les deux versions locales ne sont pas sauvegardées.
Les lignes locales qui n'avaient jamais été partagées restent dans ces copies ;
elles ne sont pas ajoutées automatiquement au scénario commun.
