# Phase 9 — client de préproduction et bêta privée

## État de lancement

Le client conserve les contrats publics v1 à v8 et l'identité Tauri séparée `com.scenario.preproduction`. Aucun secret serveur ne doit entrer dans une variable `VITE_`, dans la CSP, dans le bundle ou dans le coffre-fort de session.

Le contrôle `npm.cmd run phase9:preflight` valide localement que le client utilise l'authentification Supabase de test, une version explicite, deux URL HTTPS non factices, une clé anon/publishable et une CSP cohérente. Il refuse les noms de variables client évoquant une service role, un secret, une clé privée, Stripe, OpenAI ou un pepper. Il ne contacte aucun service et n'affiche aucune valeur.

## Préparation

1. Copier `.env.example` vers `.env.phase9.local`.
2. Remplacer l'URL API, l'URL Supabase et la clé anon par les valeurs du projet de test.
3. Remplacer les deux domaines `.invalid` dans `src-tauri/tauri.preproduction.conf.json` par ces mêmes origines HTTPS.
4. Exécuter `npm.cmd run phase9:preflight`.
5. Ne lancer le client de préproduction qu'après un résultat `PRÊT` côté client et côté serveur.

Le fichier `.env.phase9.local` est ignoré par Git. Il ne doit contenir aucun secret serveur.

## Validation externe du 12 septembre 2026

Le client local utilise désormais le mode Vite `phase9`, l'authentification Supabase hébergée et l'API `https://scenario-commercial-api-preproduction.ore-picard.workers.dev`. La CSP Tauri préproduction contient uniquement ces deux origines HTTPS, les origines internes Tauri et les endpoints locaux de développement prévus. Le préflight client indique `PRÊT`, les 61 tests passent et le build Vite `phase9` réussit.

La vérification HTTP distante confirme que l'API accepte exactement l'origine `http://127.0.0.1:1420` et refuse une lecture de compte sans session. Le parcours utilisateur hébergé reste à exécuter après création de la configuration commerciale serveur et des comptes synthétiques ; les fournisseurs Stripe et IA ne sont pas configurés et ne sont pas contactés.
