# Bêta 0.1.9 — phase 13

## Changements

- Budgets IA journalier et mensuel affichés depuis le serveur dans Compte et IA.
- Rafraîchissement après chaque appel, au premier plan et toutes les 15 secondes.
- Quota atteint, réservations en cours et réseau indisponible affichés explicitement.
- La version envoyée à l'API provient de `package.json`, y compris sur GitHub Actions.
- Inclut la connexion obligatoire et persistante de la version de travail précédente.
- Import PDF corrigé côté Worker : le résultat doit être un document natif de l'éditeur.

## Validation

- 135 tests TypeScript réussis.
- 4 tests Rust réussis, puis test explicite du coffre Windows réussi : création,
  lecture et suppression d'un jeton synthétique (aucune session réelle touchée).
- `scripts/phase13-ai-ui-e2e.mjs` : profil Edge isolé, login local, éditeur inaccessible
  avant connexion, pourcentages serveur non recalculés, quota bloqué, panne réseau,
  aucun jeton dans localStorage. Serveur Vite local-test séparé sur le port 1422.
- `node scripts/verify-updater-release.mjs` : signature cryptographique de l'installateur
  et de son commentaire, fichier altéré refusé. `--published` vérifie aussi le manifeste
  et l'installateur téléchargés depuis GitHub, sans installation.
- La clé publique des mises à jour reste celle de la 0.1.8.
- Publication GitHub réussie : [exécution 34776260920](https://github.com/orestispic/scenario-app/actions/runs/34776260920).
  Manifeste public 0.1.9 et installateur téléchargé vérifiés après publication :
  signature valide, copie altérée refusée, 4 732 533 octets.
  SHA-256 : `68ab140fdc629c214375bd640217a1141ec41692e1c68ca6178c82a76f3fbb85`.
  Le lien API d'asset généré par tauri-action est vérifié contre la release attendue
  et téléchargé avec `Accept: application/octet-stream`, comme le client Tauri.

## Essais manuels encore nécessaires

1. Sur Windows vierge : installation, ouverture, connexion, activation de l'appareil.
2. Depuis 0.1.8 : ouvrir un scénario de test, enregistrer, laisser la mise à jour s'installer,
   vérifier la version, la conservation du scénario et de la connexion.
3. Fermer puis rouvrir hors connexion avec une licence encore valide ; vérifier
   l'écriture locale, puis le retour en ligne et le renouvellement des droits.

Pas de Windows Sandbox disponible sur la machine de validation. L'installation existante
et les documents de l'utilisateur ne sont pas remplacés pour simuler un système vierge.
La signature de mise à jour Tauri est distincte d'Authenticode, non disponible à ce stade.
