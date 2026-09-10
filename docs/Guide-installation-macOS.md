# Installer Scénario sur Mac

Le fichier `Scenario-macOS.zip` contient l’application **Scénario.app** et ce guide.

1. Télécharge puis décompresse `Scenario-macOS.zip`.
2. Glisse `Scénario.app` dans le dossier **Applications**.
3. Ouvre l’application.

## Si macOS indique que l’application est « endommagée »

1. Ouvre l’application **Terminal**.
2. Copie-colle exactement cette commande, puis appuie sur la touche Entrée :

```bash
xattr -cr "/Applications/Scénario.app"
```

3. Retourne dans le dossier **Applications**.
4. Fais un clic droit sur `Scénario.app`, puis choisis **Ouvrir** et confirme **Ouvrir**.

Cette manipulation n’est nécessaire qu’une seule fois.
