# Phase 12 — préparation de la distribution senario

## Livrable

Nom public senario finalisé sur les derniers messages de marque et les métadonnées
de fichiers, avec préservation du format .scenario, identifiants Tauri/coffre,
répertoires techniques et contrats. Le nom commun « scénario » reste naturellement
dans l'éditeur. La rubrique Aide indique la version issue du package, le parcours
cloud, les sauvegardes modifiables et les informations utiles au support.

Le domaine senario.app est acheté ; les mentions contraires dans les introductions
phase11 sont historiques. SIRET fourni puis vérifié : 95295149900013, Orestis Picard
(Orestis Production). Coordonnées/support restent à définir dans le worktree site.

## Mises à jour : préparation injectable, activation encore bloquée

`src/commercial/updatePreparation.ts` fournit le contrôleur indépendant du runtime :
désactivé par défaut, une vérification/un téléchargement à la fois, annulation avant
installation, refus de réponse tardive annulée, passage obligatoire par sauvegarde
et drainage juste avant installation, libération de l'artefact et pas de retry
automatique d'installation incertaine. Les délais sont transmis par AbortSignal ;
l'adaptateur doit lui-même respecter l'annulation et borner ses I/O.

Les tests injectent un faux fournisseur. Ce contrôleur n'est pas raccordé à un
bouton d'installation et ne vérifie pas cryptographiquement un binaire : cette
responsabilité appartient au futur adaptateur natif Tauri. Il ne prouve donc pas
une mise à jour Windows réelle ni sa restauration. Aucun endpoint, clé éphémère ou
plugin actif n'est embarqué en l'absence de chaîne de signature validée.

Pour terminer, depuis ce worktree uniquement, après sélection d'un stockage sûr :

```powershell
# À exécuter ultérieurement ; pas exécuté dans ce lot.
npm.cmd run tauri add updater
# Choisir d'abord un dossier de clés protégé hors dépôts et sauvegardé.
npm.cmd run tauri signer generate -- -w 'D:\senario-keys\updater.key'
```

Ne jamais imprimer/transmettre la clé privée. Installer sa clé PUBLIQUE dans un
profil Tauri de distribution distinct avec endpoint HTTPS détenu, activer
createUpdaterArtifacts, configurer Authenticode et un horodatage fiable. Réserver
les permissions updater aux commandes nécessaires. L'adaptateur doit vérifier
la signature via le plugin, rejeter rollback de version et origine inattendue,
télécharger un artefact immuable puis appeler le contrôleur. Sauvegarder la clé
privée hors site : sa perte empêcherait les futures mises à jour des installations
ayant cette clé publique. Authenticode et signature updater sont indépendants.

La callback secureWorkspace doit bloquer les éditions, écrire le .scenario courant,
vérifier le résultat, drainer les opérations cloud ou conserver une copie récupérable,
fermer les canaux puis autoriser l'installation. Sur annulation, rétablir l'édition.
Tester ce raccordement avec la vraie application avant activation ; il n'est pas
remplacé par les callbacks synthétiques des tests de phase12.

## Recette Windows à exécuter sur VM dédiée

1. Snapshot d'une VM Windows vierge. Relever version, SHA-256, certificat et timestamp.
2. Installer pour l'utilisateur courant, ouvrir un projet existant ; vérifier que
   l'application source et les associations .scenario restent intactes pour la bêta.
3. Créer scénario, commentaires et garde, enregistrer/exporter, fermer/rouvrir et
   vérifier bytes/contenus ; le PDF n'est pas un substitut à la sauvegarde .scenario.
4. Installer une nouvelle version signée, comparer les projets et le coffre ; tester
   téléchargement interrompu, signature invalide et réseau absent sans perte locale.
5. Retour arrière avec un installateur signé compatible et une copie sauvegardée,
   jamais en rendant les anciennes versions cloud mutables.
6. Désinstaller la bêta : vérifier la conservation des documents et de la source.
   Les règles de retrait des identifiants du coffre nécessitent une vérification séparée.

Le certificat Windows reste absent. Un exe NSIS non signé peut être exécuté par
Windows avec avertissements ; il ne satisfait pas le critère de distribution
retenu pour senario. Ne pas présenter ce critère interne comme une obligation légale.

Sources : https://v2.tauri.app/plugin/updater/ et
https://v2.tauri.app/distribute/sign/windows/.

## Vérifications et limites

Tests application (123) et build frontend/typecheck réussis. Préparation updater :
quatre tests couvrent désactivation, double clic, ordre vérification/sauvegarde,
signature refusée, annulation, sauvegarde échouée et installation incertaine.
Ces tests sont locaux simulés. NSIS et Rust sont consignés dans l'addendum après
exécution. Aucun changement de version de contrat, aucune migration et aucun push.

Addendum : compilation NSIS réussie, 3 464 068 octets, statut NotSigned attendu,
SHA-256 `65a28ddefb89d0bc3006f8636c1501f0f53631c48a7d398a1fd71a92574351b9`.
Trois tests Rust réussis ; un test explicite du coffre OS reste ignoré par défaut.
L'installateur n'a pas été installé ni publié. Commandes complètes dans le document
`19-PHASE-12-PUBLICATION.md` du worktree site.
