# Stabilité collaborative

La connexion appartient au runtime de l'application, pas au panneau du compte.
Une seule boucle réseau sérialisée, annulable et protégée par génération assure
les lectures, heartbeats, envois et reprises. Le statut connecté signifie que le
rattrapage a effectivement réussi, pas seulement que le ticket a été accepté.

Les anciennes notifications de fermeture de profil ne ferment pas une nouvelle
connexion. L'expiration d'un canal ne déconnecte plus le compte. Les refus
d'autorisation restent bloquants ; les conflits et curseurs trop anciens demandent
une récupération au lieu de relancer une connexion sans fin.

Le canal lit et envoie au maximum une fois toutes les quatre secondes par boucle.
Une erreur de lecture maintient un backoff sans couper les heartbeats. Les requêtes
du canal expirent après huit secondes ; les limitations attendent au moins une
minute. Les réponses tardives ne peuvent ni modifier l'éditeur ni relancer les
timers après arrêt. Vite libère l'ancien runtime lors du remplacement d'un module.

Les requêtes jamais envoyées sont regroupées par bloc ; toute opération déjà
tentée garde son UUID et checksum pour les retries. Le curseur de lecture ne saute
pas à celui d'un accusé d'écriture. Les opérations issues d'une autre instance du
même compte restent des changements distants à appliquer.

Une collision avec du texte local non confirmé arrête la fusion et propose une
copie. Le texte complet dans l'éditeur reste intact. Arrêter la collaboration
libère son état en mémoire ; enregistrer le fichier local ou télécharger la copie
avant cet arrêt si une récupération est nécessaire. Aucun ticket, jeton ou contenu
collaboratif n'est ajouté à localStorage.

`node scripts/realtime-soak.mjs 120` utilise le vrai client pendant deux minutes
avec les trois comptes de préproduction existants. Il n'envoie aucune opération
d'édition et ferme uniquement ses propres canaux et sessions. Le résultat de ce
test ne prouve pas un service de production résistant à toute panne. La stratégie
de blocs v8 garde ses limites : les modifications concurrentes du même bloc peuvent
nécessiter une récupération manuelle.

Les corrections de la contrainte de séquence SQL, de la réconciliation et de la
concurrence serveur sont décrites dans `docs/commercial/14-REALTIME-STABILITY.md`
du worktree plateforme. Les contrats publics v1 à v8 restent inchangés.

## Vérification sur la préproduction autorisée

Après autorisation explicite de l'utilisateur, la migration de séquence
`20260922000000` a été appliquée à `zblnsdyaoljnezxdidtx` et le Worker du commit
plateforme `6ebd21c` a été déployé (version Cloudflare
`bee273c7-bde7-4509-aa02-ee1a2cf7f016`). Le client utilisé ici est celui du commit
`46290ce`. Le serveur Vite sur `127.0.0.1:1420` sert effectivement le module corrigé
(HTTP 200, garde de génération, état de récupération et espacement des lectures).

Le premier `node scripts/realtime-soak.mjs 120` après déploiement a permis le
rattrapage des anciennes opérations : deux erreurs transitoires de journal
incomplet pour owner au démarrage, puis aucun nouvel échec et une seule connexion
par compte. Son assertion stricte a donc échoué ; il est classé comme passage de
récupération, pas comme succès de stabilité.

Le test hébergé de la plateforme `phase9:realtime:validate` a ensuite réussi avec
les trois comptes synthétiques, le rejeu sans doublon, le refus viewer et les
contrôles SQL/stockage du snapshot existant. Ce test n'est pas une nouvelle
compaction et ne remplace pas une observation continue du client applicatif.

Le passage neuf `node scripts/realtime-soak.mjs 300` a ensuite **réussi** avec code
de sortie 0 : cinq minutes, une seule connexion, 71 lectures et 29 heartbeats pour
chacun des trois comptes, aucune erreur HTTP ni transition en reconnexion.
Owner/editor sont restés en ligne et viewer en lecture seule. Ce contrôle est
réel sur la préproduction, mais sans nouvelle édition, coupure injectée, veille
navigateur ni test de charge. Il ne prouve pas une stabilité illimitée. Les tests
locaux et builds déjà réussis n'ont pas été relancés pour ces ajouts documentaires ;
`git diff --check` a été exécuté dans les deux worktrees.

Les diagnostics ferment leurs propres canaux et sessions uniquement. Dans un
onglet déjà ouvert, arrêter puis démarrer la collaboration permet de renouveler
le canal sans recharger toute la page. Enregistrer d'abord le scénario local et
télécharger la copie de récupération si un conflit est affiché. Un rechargement
complet peut demander une nouvelle connexion au compte : les jetons de la version
navigateur ne sont volontairement pas persistés dans localStorage.
