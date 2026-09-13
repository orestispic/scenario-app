# Licence hors ligne — protections et limites

Le service démarre avec l'éditeur. Il restaure une licence vérifiée, renouvelle au
démarrage, au retour du réseau et toutes les 15 minutes. Une vérification locale
chaque minute retire les droits affichés après expiration. Le mode gratuit local
(édition, enregistrement, export) reste accessible ; les fonctions serveur
continuent à revérifier leurs propres droits à chaque appel.

Le Worker signe l'identifiant d'appareil actif, son empreinte, l'heure serveur et
le snapshot complet. Le client refuse les anciens certificats non liés à un
appareil pour le mode hors ligne renforcé. Une activation suivie d'une connexion
au Worker mis à jour est nécessaire. Les routes existantes restent compatibles.

Le certificat signé reste dans le cache local ; une empreinte SHA-256 exacte du
cache, la clé publique, l'identité et la dernière heure connue sont ancrées dans
le coffre système existant. Remplacer/copier le cache sans cet ancrage ne donne
aucun droit. Le navigateur ne conserve cet ancrage qu'en mémoire : le redémarrage
hors ligne durable est réservé à l'application native.

Le recul de l'horloge de plus d'une minute exige une reconnexion. Une horloge
monotone protège également la session en cours. La date limite signée ne peut
être prolongée par le cache. Une déconnexion ou un refus 401/403 efface l'ancrage.

Durées calculées exclusivement côté serveur : mensuel payé jusqu'à la fin de
période + 3 jours (maximum 34 jours), annuel payé au maximum 30 jours et jamais
après la période payée. Essais et droits temporaires gardent leur limite serveur.
La révocation hors ligne n'est observable qu'à la reconnexion ou l'expiration.
Un administrateur contrôlant entièrement l'OS peut modifier le programme ; cette
solution n'est pas une garantie anticopie absolue, ni une attestation matérielle.

Validation : tests cryptographiques de renouvellement/restauration/expiration,
cache remplacé, autre appareil, recul d'horloge, suppression des droits sans
toucher aux documents. Tests serveur d'émission par appareil actif et révocation.
Le coffre Windows réel, le redémarrage natif hors réseau et les appels au Worker
hébergé doivent encore être validés après compilation native et déploiement.
Aucun déploiement ni migration SQL n'est effectué par cette modification.
