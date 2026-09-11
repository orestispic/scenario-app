# Phase 4 — sessions système et cache signé complet

Lire également `scenario-site-commercial/docs/commercial/08-PHASE-4-PREPRODUCTION.md` pour le protocole, l’exploitation, les tests et les limites externes.

`SessionManager` utilise un `RefreshTokenVault` injectable. Il conserve l’access token seulement en mémoire, sérialise les écritures du refresh et mutualise le renouvellement concurrent. Un logout invalide la génération en cours avant les opérations asynchrones ; un refresh tardif est révoqué et ne recrée pas la session. Une panne réseau conserve le refresh pour une nouvelle tentative ; un refus terminal le supprime. Un échec d’écriture du coffre-fort refuse la nouvelle session.

`tokenVault.ts` utilise les commandes Rust `read_refresh_token`, `write_refresh_token`, `clear_refresh_token`. `keyring` 3.6.3 active explicitement Windows Credential Manager et macOS Keychain. Le service système est limité à Scénario commercial et la portée contient les URLs API/auth pour séparer les environnements. Les erreurs ne contiennent pas de valeur secrète. Hors Tauri, le preview garde une entrée mémoire non persistante ; il n’y a jamais de repli navigateur après une erreur native.

`offlineTrust.ts` utilise une autre entrée système pour la clé publique et le compte reçus en ligne. L’access token et le refresh n’y sont pas copiés. Cela ancre le cache après un redémarrage hors ligne. Le contrat `2026-09-v4` et `/v3/entitlements` lient la signature ES256 au contenu intégral du snapshot, au compte et aux dates. Le client refuse les anciens caches comme preuve v4, le contenu modifié, le compte différent et l’expiration exacte. La durée vient toujours du serveur. Le retour hors ligne est réservé aux erreurs réseau/502/503/504 ; un 401 ne devient pas un succès hors ligne.

Le panneau Compte restaure la session, renouvelle avant les requêtes et affiche le cache encore valide en cas de panne. L’action Actualiser/Se reconnecter retente les lectures ; les mutations restent toujours des appels API. La déconnexion retire cache et ancre de confiance, sans toucher aux fichiers de scénario. Un défaut préexistant du formulaire de clé (référence d’événement React après await) est corrigé en gardant la référence au formulaire.

`src-tauri/tauri.preproduction.conf.json` sépare identité et CSP de la préproduction. Ses domaines de test sont des placeholders à remplacer lors de la fourniture des environnements. Le `devCsp` permet le Worker local. Aucune configuration de production ni aucun dossier source/mac n’est modifié.

Validations : Vitest (sessions, contrats, coffre-fort injecté, cache et tests existants), build TypeScript/Vite, lint TS ciblé, Cargo check, smoke natif Windows avec entrée éphémère supprimée, rustfmt du nouveau module. Le format global Rust présente des écarts historiques dans `lib.rs` sans rapport avec cette phase ; ils ne sont pas réécrits.

Les sessions Supabase et le Keychain macOS restent à valider sur leurs environnements réels. La révocation distante échouée hors réseau ne peut être promise ; les JWT Supabase déjà émis restent potentiellement valides jusqu’à leur expiration configurée serveur. Aucune donnée de prix, quota, droit, limite d’appareils ou secret fournisseur n’est ajoutée au client.
