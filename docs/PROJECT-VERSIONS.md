# Versions nommées — état de livraison

## Disponible dans le code de l’application

- Menu Version à droite du type de paragraphe, avec sélection, duplication d’une source choisie, création vierge, renommage, suppression récupérable et restauration.
- Un seul fichier `.scenario` contient toutes les versions du projet. Chaque version possède un identifiant stable, un nom, sa provenance et son texte, ses commentaires et sa page de garde indépendants.
- Promotion du format 1 au format 2 à la première action de gestion des versions. Les anciens fichiers restent lisibles. Les anciennes applications refusent le format 2 au lieu d’en supprimer les versions.
- Copie de secours de la version sortante et écriture atomique de la récupération complète avant de modifier l’éditeur. Les écritures de récupération et de fichier sont ordonnées. En cas d’échec, la sélection et le contenu courants restent en place.
- Pas de changement concurrent pendant une sauvegarde, une ouverture, une opération IA ou un export/import. L’éditeur et les raccourcis sont verrouillés pendant la transition ; l’historique Annuler est réinitialisé entre versions.
- Une récupération plus récente que le fichier est restaurée. Un abandon explicite à la fermeture conserve une copie de secours puis retire la récupération automatique.
- La dernière version ne peut pas être supprimée. Les suppressions sont des marqueurs récupérables et ne purgent aucun contenu.

## Limite explicite : cloud non livré

Le serveur déployé accepte seulement le format 1, et la collaboration utilise un canal unique par projet. Les versions nommées sont donc **désactivées dans tous les projets cloud**. L’envoi d’un fichier local à versions vers ce serveur est refusé avant la requête, sans conversion destructive. Les fichiers cloud existants continuent de fonctionner comme auparavant.

Il reste à implémenter et autoriser la migration serveur : identité de version dans les autorisations, métadonnées, opérations temps réel, séquences et sauvegardes ; séparation des canaux ; compatibilité des anciens clients ; conflits de création/suppression et clients hors ligne. Ne pas simplement autoriser le format 2 dans l’ancien canal : les versions partageraient alors le même contenu collaboratif.

Aucune migration Supabase ni aucun déploiement du Worker n’a été effectué pour ces changements. Aucun nouvel installateur Windows n’a été publié.

## Vérifications exécutées

- 167 tests Vitest : format historique, copies indépendantes, choix de la source, version vierge, capture de la version sortante, suppression/restauration, noms ambigus, fichiers incohérents, ordre des écritures, échecs d’écriture, refus du serveur cloud historique, autres régressions.
- `scripts/project-versions-e2e.mjs` : parcours réel dans Edge headless, commentaires/couverture, Annuler entre versions, autosave après plusieurs modifications, réouverture face à un ancien fichier disque, panne de sauvegarde simulée, édition et raccourcis bloqués durant la transition, enregistrement du fichier complet.
- `scripts/phase14-account-e2e.mjs` : ordre Gratuite → Auteur → Studio, absence de slider, comptes fictifs, activation, limite d’appareils, déconnexion et écriture hors ligne.
- `scripts/phase13-ai-ui-e2e.mjs` : pourcentages transmis par le serveur de test, sans jauge mensuelle ni réglage local de quota, actualisation et indisponibilité réseau.
- Compilation TypeScript/Vite réussie (avertissement préexistant sur la taille des bundles).

Les tests navigateur utilisent des profils isolés et des doubles de persistance/API : ils ne touchent ni les projets, ni les comptes, ni le coffre d’identifiants réels. Ils ne remplacent pas une recette de l’installateur Windows ni une validation cloud multi-utilisateur, qui restent à effectuer après l’implémentation serveur.
