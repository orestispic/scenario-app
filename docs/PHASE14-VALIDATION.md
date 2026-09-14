# Phase 14 — Windows 0.1.12 publiée

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

### Résultat Windows : réussi

[Exécution GitHub 34834676960](https://github.com/orestispic/scenario-app/actions/runs/34834676960)
du 14 septembre 2026 : ouverture de l'éditeur gratuit dans les trois installations,
migration de l'identité réelle du profil 0.1.11, sauvegarde/relecture native,
désinstallation et réinstallation avec profil web vierge, même identité retrouvée.
Le refresh token synthétique du coffre et le document témoin sont conservés.
Les entrées synthétiques du coffre et les réglages de test WebView2 sont nettoyés.

Les premiers essais du pilote ont échoué : WebView2 récent ignore les paramètres
d'environnement pour les processus administrateurs du runner. Le pilote utilise
désormais une politique machine limitée à `scenario-app.exe`, uniquement dans le
runner éphémère. Aucun port de débogage n'est activé dans l'application distribuée.
Le candidat signé n'a pas été reconstruit ; les sources applicatives testées sont
comparées au tag avant publication. Le workflow de reprise refuse une release déjà
publiée et le pipeline normal déduit le numéro de version automatiquement.

## Publication vérifiée

- Release : [v0.1.12](https://github.com/orestispic/scenario-app/releases/tag/v0.1.12).
- Manifeste public : 0.1.12, installateur de 4 739 455 octets.
- Signature cryptographique valide ; copie volontairement altérée refusée.
- SHA-256 : `44441a5d6bb21e752edbcfa2f51bda2c77de28ee118ed799cc16a0cbbc32531f`.
- [Page de téléchargement](https://senario.app/telecharger) publiée depuis le commit
  site `9bdc097cee57af6cd46e1fad59358ac92dc1c343`.
- Contrôle sur le domaine public à 1280 px et 390 px : version, lien stable vers
  l'installateur, navigation vers les offres, aucun débordement ni erreur JavaScript.

## Limites

La signature Tauri n'est pas Authenticode. Le canal reste une bêta et Stripe test.
Une suppression explicite du coffre ou du compte Windows efface l'identité.
Le maintien de la session réelle dépend également de sa validité côté Supabase.
Le coffre a été testé avec un jeton synthétique, pas en réutilisant la session
personnelle de l'utilisateur. La restauration/rotation de session, l'expiration
du bail hors ligne et les protections contre la copie sont testées séparément.
