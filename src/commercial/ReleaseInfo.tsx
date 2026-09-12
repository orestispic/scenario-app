import { version } from '../../package.json';
export function ReleaseInfo() {
  return <section>
    <h3>senario · Version {version}</h3>
    <p>Pour signaler un problème, indique cette version, ton système et les étapes pour le reproduire au contact de la bêta. Ne joins ni mot de passe ni texte confidentiel.</p>
    <p>Les mises à jour automatiques ne sont pas encore ouvertes. Avant de remplacer l’application, enregistre tes projets en <code>.scenario</code> et conserve une copie. Un PDF ne remplace pas le fichier modifiable.</p>
    <p>Dans <strong>Projets cloud</strong>, un projet reste privé tant que tu ne le partages pas. Les éditeurs peuvent travailler sur le texte, les commentaires et les premières pages ; les lecteurs consultent le projet. En cas de conflit, conserve d’abord une copie locale.</p>
  </section>;
}
