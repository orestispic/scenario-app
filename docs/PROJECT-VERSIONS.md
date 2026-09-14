# Versions nommées — état de livraison

## Disponible dans le code de l’application

- Menu Version à droite du type de paragraphe, avec sélection, duplication d’une source choisie, création vierge, renommage, suppression récupérable et restauration.
- Un seul fichier `.scenario` contient toutes les versions du projet. Chaque version possède un identifiant stable, un nom, sa provenance et son texte, ses commentaires et sa page de garde indépendants.
- Promotion du format 1 au format 2 à la première action de gestion des versions. Les anciens fichiers restent lisibles. Les anciennes applications refusent le format 2 au lieu d’en supprimer les versions.
- Copie de secours de la version sortante et écriture atomique de la récupération complète avant de modifier l’éditeur. Les écritures de récupération et de fichier sont ordonnées. En cas d’échec, la sélection et le contenu courants restent en place.
- Pas de changement concurrent pendant une sauvegarde, une ouverture, une opération IA ou un export/import. L’éditeur et les raccourcis sont verrouillés pendant la transition ; l’historique Annuler est réinitialisé entre versions.
- Une récupération plus récente que le fichier est restaurée. Un abandon explicite à la fermeture conserve une copie de secours puis retire la récupération automatique.
- La dernière version ne peut pas être supprimée. Les suppressions sont des marqueurs récupérables et ne purgent aucun contenu.

## Versions cloud — préproduction validée

Le même menu propose les versions du projet cloud ouvert. Chaque version utilise
son propre scénario de stockage, ses métadonnées et son canal temps réel. Les
droits restent ceux du projet parent. Le lecteur change de version ; l’éditeur
peut dupliquer/créer/renommer ; le propriétaire peut aussi supprimer/restaurer.

Avant de changer, la version sortante doit être synchronisée et une copie locale
est conservée. Une erreur réseau, un conflit ou des écritures en attente bloquent
la transition. Les copies sont isolées par compte et scénario de version. Une
réponse arrivée après fermeture/déconnexion ne rouvre pas l’ancien projet.

Les migrations 20260927000000, 20260927100000 (contrat de téléchargement),
20260927200000 (ordre des verrous) et 20260927300000 (administration du projet)
sont appliquées au Supabase autorisé
`zblnsdyaoljnezxdidtx`. Le Worker de préproduction expose le contrat v14.
L’ancien historique de sauvegardes reste distinct des versions nommées.

Limite explicite : l’import dans le cloud d’un fichier local qui contient déjà
plusieurs versions reste refusé, sans suppression ni aplatissement. Les versions
peuvent être créées directement dans un projet cloud. Le téléchargement de la
copie courante exporte uniquement cette version, pas tout le projet cloud.
Aucun nouvel installateur Windows n’a été publié dans cette étape.

## Vérifications exécutées

- 173 tests Vitest : versions locales, isolation cloud A/B, refus de changement hors ligne, suppression distante, répétition idempotente et fermeture pendant une requête.
- `scripts/project-versions-e2e.mjs` : parcours réel dans Edge headless, commentaires/couverture, Annuler entre versions, autosave après plusieurs modifications, réouverture face à un ancien fichier disque, panne de sauvegarde simulée, édition et raccourcis bloqués durant la transition, enregistrement du fichier complet.
- `scripts/phase14-account-e2e.mjs` : ordre Gratuite → Auteur → Studio, absence de slider, comptes fictifs, activation, limite d’appareils, déconnexion et écriture hors ligne.
- `scripts/phase13-ai-ui-e2e.mjs` : pourcentages transmis par le serveur de test, sans jauge mensuelle ni réglage local de quota, actualisation et indisponibilité réseau.
- Compilation TypeScript/Vite réussie (avertissement préexistant sur la taille des bundles).

`scripts/cloud-versions-ui-e2e.mjs` vérifie aussi l’interface cloud réelle avec
un serveur fictif : ouverture, duplication, sauvegarde sortante, A/B, vierge et
suppression. Ces tests navigateur n’utilisent pas les fichiers ou identifiants réels.

La validation hébergée distincte du serveur utilise les comptes synthétiques
Owner/Editor/Viewer : canaux indépendants, duplication du texte en direct,
commentaires/premières pages, concurrence, suppression/restauration et révocation.
Les projets de test sont ensuite placés dans la corbeille et leurs sessions fermées.
La recette d’un nouvel installateur Windows reste à effectuer après sa génération.
