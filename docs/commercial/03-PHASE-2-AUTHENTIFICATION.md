# Phase 2 — compte authentifié dans l’application

Le panneau Compte utilise désormais le contrat `2026-09-v2`. En mode Supabase, inscription, connexion et récupération passent par Supabase Auth avec la seule clé anon/publishable. Le Worker valide le jeton et renvoie profil, droits et appareils. La clé `service_role`, le pepper et la clé privée de cache ne sont jamais présents dans le client.

Le mode `local-test` n’est disponible que lorsque Vite compile en développement et que `VITE_SCENARIO_AUTH_MODE=local-test`. Il choisit une identité mais ne contient aucun droit : ceux-ci sont lus sur le Worker local séparé.

Le cache v2 est écrit uniquement après validation ECDSA P-256. Une charge modifiée, une clé inattendue, un instantané incohérent ou une date dépassée sont refusés. Les tests couvrent signature, modification et expiration.

Les jetons restent volontairement en mémoire pendant cette phase. L’intégration ultérieure devra placer le refresh token dans le coffre-fort système Tauri et conserver l’access token court en mémoire.
