# Phase 11 — senario, bêta Windows

Nom public demandé : **senario**. Le domaine `senario.app` a depuis été
acheté ; pas de boîte support ni certificat Windows fourni. Le site commercial
et son parcours font l'objet du document `18-PHASE-11-BETA-SENARIO.md` dans le
worktree site. La publication publique n'est pas déclarée prête.

## Compatibilité

Nom de fenêtre et libellés de marque mis à jour, index français et titre lisible.
Préservation du nom technique Cargo/binaire, des identifiants Tauri
`fr.orepi.scenario` / `com.scenario.preproduction`, du coffre, des clés de stockage,
du format `.scenario`, des contrats et exports. « scénario » reste le nom commun
du document : ce n'est pas une migration de contenus utilisateur.
Le dossier mac et les dépôts source restent intacts.

## Installateur

`npm.cmd run build:beta` compile uniquement NSIS Windows avec le profil phase9,
donc les vraies origines de préproduction autorisées par CSP. La bêta porte le
nom **senario Beta**, conserve l'identifiant de préproduction et s'installe pour
l'utilisateur courant. Ses hooks et fileAssociations vides ne remplacent pas
l'association `.scenario` de l'installation source. L'ouverture par le menu
Fichier reste disponible. Le raccourci de la bêta reste distinct.

Artefact généré localement :
`src-tauri/target/release/bundle/nsis/senario Beta_0.1.7_x64-setup.exe`.
Non committé, non signé, non installé et non publié. Le build n'est pas un test
d'installation/désinstallation sur Windows vierge. Le script
`scripts/inspect-beta-installer.ps1` calcule SHA-256, taille et statut Authenticode
du seul artefact attendu dans ce worktree. `-RequireSigned` refuse cet artefact.

Ne pas utiliser l'ancien workflow de publication source pour diffuser la bêta.
Avant sortie : certificat Windows, génération et sauvegarde durable de la clé
updater, endpoint HTTPS détenu, installation du plugin et activation du parcours
de mise à jour signée, test d'interruption/reprise puis retour arrière compatible.
Ces fonctions de mise à jour automatique ne sont **pas implémentées/activées dans
ce lot**, faute de chaîne de distribution validée ; l'application ne contacte
aucun domaine supposé appartenir à l'utilisateur. Les anciennes versions de
projets restent immuables, et une copie locale doit précéder un redémarrage.

## Convergence et performance locale

La projection collaborative clone le document de base une fois par batch au lieu
de le recopier intégralement pour chaque opération. L'ordre LWW v8 et les conflits
existants restent inchangés. La limite de registres refuse désormais l'opération
avant mutation de l'état accepté. Test : 5 000 paragraphes et 1 000 opérations,
trois répliques, doublons et livraison inversée, même résultat sans mutation du
document de base. Test additionnel d'équivalence avec la projection historique.
Ce n'est pas une garantie de fluidité graphique pour toute taille de scénario.

## Vérifications

119 tests application réussis ; trois tests Rust ordinaires réussis. Le test
`native_vault_roundtrip` a aussi été explicitement exécuté avec succès : une
entrée synthétique créée/lue/supprimée, aucun identifiant utilisateur consulté.
Build Tauri NSIS réussi avec avertissement de taille de bundle web déjà connu.
E2E commentaires/garde avec trois comptes synthétiques locaux : réussi.
Soak **réel** 300 secondes Supabase/Cloudflare, trois comptes existants : zéro
erreur ni reconnexion, convergence finale. Cela ne remplace ni un soak de plusieurs
heures, ni une panne injectée, ni une installation native sur machine vierge.

Commandes et limites détaillées dans le document serveur phase11. Aucun push,
paiement réel, envoi d'e-mail, installation ou publication de binaire. Les sessions
du navigateur restent volontairement volatiles ; actualiser demande de se reconnecter.

Dernière compilation NSIS après optimisation : 3 464 201 octets ;
SHA-256 `b5435f0e6a05785ac1c53365a33bb3b45c537e5996df8dbcf45b0c7c813b56ad`.
Contrôle Authenticode : `NotSigned`, publication refusée comme attendu.
Le nouveau site a aussi été testé réellement depuis Edge contre Supabase et
Cloudflare (compte synthétique, catalogue, mobile et déconnexion). Aucun e-mail
ou paiement réel. L'API v11 du site est en préproduction, pas le site public.
