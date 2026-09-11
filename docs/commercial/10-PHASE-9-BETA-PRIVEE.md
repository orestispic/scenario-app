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

Le fichier `.env.phase9.local` est ignoré par Git. Il ne doit contenir aucun secret serveur. Au lancement de la phase, les domaines et clés sont encore des placeholders : la validation externe du client reste donc bloquée sans accès de test fournis.
