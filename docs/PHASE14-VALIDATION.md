# Phase 14 — candidate Windows 0.1.12

## Changements

- Activation automatique partagée par la page Compte, les appels IA/cloud et le
  renouvellement de licence. Une ouverture de Compte n'est plus nécessaire.
- Migration de l'identifiant existant vers le coffre système. Une réinstallation
  sous le même utilisateur Windows conserve ce coffre. Une panne du coffre ne
  crée plus une identité de remplacement. L'édition locale reste disponible.
- Limite d'appareils : message explicite et retrait d'un ancien appareil depuis
  Compte. Rafraîchir Compte ne relance plus une activation déjà réussie.
- Pipeline : release en brouillon, signature vérifiée, tests Windows sur machine
  GitHub temporaire, puis publication uniquement après succès.

## Exécuté le 14 septembre 2026 avant publication

- 145 tests client ; 167 tests serveur ; TypeScript et contrôle de secrets.
- Navigateur Edge isolé : gratuit sans compte, Auteur/Studio, autorisation
  automatique, plafond d'appareils, retrait puis autorisation, absence de doublon,
  déconnexion, édition sans réseau, pourcentages serveur et indisponibilité IA.
- Coffre Windows réel, trois processus : création, récupération de la même
  identité avec une autre proposition, conservation d'un refresh synthétique,
  nettoyage de l'entrée synthétique seulement.
- Préproduction réelle avec les comptes synthétiques : IA, traduction, import
  PDF, idempotence sans double débit, quotas et refus des paramètres interdits.
- Trois projets synthétiques : cloud privé/partagé, Owner/Editor simultanés,
  Viewer en lecture seule, isolation, rejeu, révocation, commentaires/réponses,
  page de garde, conflits et conservation dans les snapshots.
  Les trois projets ont été placés dans la corbeille ; historique conservé.

## Installation Windows

`scripts/phase14-windows-lifecycle.ps1` est réservé aux runners GitHub éphémères.
Il installe 0.1.11, ouvre le binaire réel via WebView2, relève l'identité historique,
met à jour vers 0.1.12, vérifie identité et sauvegarde native, désinstalle puis
réinstalle avec un nouveau profil web et vérifie de nouveau l'identité.
Le coffre des sessions et un fichier synthétique sont vérifiés à chaque étape.
Le parcours de mise à jour automatique (attente d'une sauvegarde, panne réseau)
est testé séparément par Vitest ; l'installateur réel est exécuté par le script.

## Limites

La signature Tauri n'est pas Authenticode. Le canal reste une bêta et Stripe test.
Une suppression explicite du coffre ou du compte Windows efface l'identité.
Le maintien de la session réelle dépend également de sa validité côté Supabase.
