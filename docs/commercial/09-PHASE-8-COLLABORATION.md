# Phase 8 — client collaboratif Studio

Le client utilise le contrat miroir `2026-09-v8` et `StudioCollaborationClient`. Le panneau Studio relie l’éditeur Tiptap existant seulement après une action explicite et après lecture de la version cloud courante. Il affiche connexion, reconnexion, membres présents, retard, conflit et lecture seule après révocation.

L’adaptateur compare les blocs racine possédant un `blockId`, émet des upserts/tombstones bornés et applique une mutation distante au seul bloc concerné. Les fichiers `.scenario`, sauvegardes, exports, couverture et commentaires existants ne sont ni migrés ni supprimés. Une panne conserve l’éditeur local utilisable et retente avec backoff borné. Un conflit propose une copie JSON locale des opérations non confirmées.

Tickets, identifiants de connexion, opérations, contenu distant, URLs temporaires et jetons ne sont jamais écrits dans `localStorage`. Le ticket n’existe que dans une variable le temps du handshake. L’access token reste dans la mémoire de session v4 et le refresh token dans le coffre-fort système. Le démontage/déconnexion ferme le canal, arrête timers et requêtes, vide l’état collaboratif sensible et remet l’éditeur local en écriture sans toucher au fichier.

La collaboration du corps de scénario est fonctionnelle avec le faux serveur local. Le canal Cloudflare, Supabase/RLS et le stockage de snapshots réels restent bloqués faute d’infrastructure de test fournie ; les fixtures ne constituent pas une validation externe.
