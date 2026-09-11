# Phase 6 — client de synchronisation

Le client conserve tous ses fichiers `.scenario` et exports historiques. Le menu **Fichier → Synchroniser dans le cloud…** enregistre d’abord le fichier local, puis alimente une file v1 injectable. Une entrée ne stocke jamais le contenu, un jeton ou une URL signée : seulement le chemin local, l’identifiant stable, le parent distant, le checksum et l’état `local|pending|synced|conflict|failed`.

La file recalcule le SHA-256 sur le fichier au moment de l’envoi, dérive une clé d’idempotence stable de l’identifiant/parent/contenu et applique cinq tentatives au maximum avec backoff exponentiel borné à 60 secondes. Un redémarrage relit les entrées `pending`; une panne serveur conserve l’attente. Un conflit conserve le fichier local et propose les primitives `keepLocal`, `downloadRemote` et `createCopy`. Aucune réponse du cache de droits hors ligne n’autorise un appel cloud.

La déconnexion efface la file de synchronisation et donc chemin local, compte implicite et identifiants distants, tout en laissant intact le fichier `.scenario`. L’access token reste uniquement en mémoire et le refresh token dans le coffre-fort système de phase 4 ; aucun jeton n’est ajouté à `localStorage`.

Le stockage navigateur de la file est une indexation locale et non une source de vérité cloud. Le document lui-même reste le fichier Tauri. Le serveur décide droits, version minimale, appareil, limites, rôles et conflits.

Validation locale :

```powershell
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```
