# Phase 3 — abonnement et activation dans l’application

Le panneau Compte utilise le contrat miroir `2026-09-v3`. Après authentification, il lit auprès de l’API l’état d’abonnement, sa période, sa source et les activations existantes. Il ne contient aucun montant, identifiant Stripe, offre, quota, droit ou limite d’appareils.

La saisie d’une clé transmet uniquement la clé brute et l’identité locale de l’appareil à `/v2/activation-keys/redeem`. Le Worker calcule les empreintes, vérifie expiration/révocation/maxima, crée le snapshot et active l’appareil. L’application recharge ensuite droits, facturation, activations et appareils depuis l’API, puis n’écrit le cache qu’après vérification de la signature ECDSA existante.

Le mode `local-test` reste conditionné par `import.meta.env.DEV`. La clé brute n’est ni journalisée ni stockée par l’application; le champ est réinitialisé après succès. Les jetons restent en mémoire comme décidé en phase 2. Leur passage au coffre-fort système Tauri est réservé à la phase 4.
