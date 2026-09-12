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
