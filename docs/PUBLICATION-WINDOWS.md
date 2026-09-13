# Publication Windows et mises à jour

## Ce qui est automatisé

Lorsqu’un tag `vX.Y.Z` est poussé, `.github/workflows/release.yml` :

1. teste l’application ;
2. construit l’installateur NSIS Windows 64 bits ;
3. signe l’artefact de mise à jour ;
4. publie `Scenario-Setup.exe`, sa signature et `latest.json` dans la version GitHub.

L’application vérifie `latest.json` au démarrage puis toutes les six heures. Elle télécharge une nouvelle version en arrière-plan. Si le scénario courant n’est pas enregistré, l’installation attend sa sauvegarde.

## Clé de mise à jour

La clé privée n’est jamais stockée dans Git. Elle se trouve, chiffrée, dans :

`%LOCALAPPDATA%\Senario\release\senario-updater-v1.key`

Son mot de passe est protégé pour le compte Windows courant dans :

`%LOCALAPPDATA%\Senario\release\senario-updater-v1-password.dpapi`

La clé publique est la seule clé intégrée à `src-tauri/tauri.conf.json`.

Avant la première publication automatisée, créer dans GitHub, dépôt `orestispic/scenario-app`, les secrets Actions suivants :

- `TAURI_SIGNING_PRIVATE_KEY` : contenu complet de `senario-updater-v1.key` ;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : mot de passe déchiffré localement par Windows.

Ne jamais envoyer ces valeurs dans une discussion, un ticket ou un commit.

## Nouvelle version

1. mettre le même numéro dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml` ;
2. exécuter les tests et la construction locale ;
3. créer puis pousser le tag correspondant, par exemple `v0.1.8`.

Le certificat Tauri protège l’intégrité des mises à jour. Il ne remplace pas un certificat de signature de code Windows : tant que ce certificat commercial n’est pas acquis, SmartScreen peut encore afficher « Éditeur inconnu » pendant la bêta.
