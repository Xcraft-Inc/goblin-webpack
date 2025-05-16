# 📘 Documentation du module goblin-webpack

## Aperçu

Le module `goblin-webpack` est un service qui encapsule et configure Webpack pour l'écosystème Xcraft. Il fournit des fonctionnalités pour compiler et servir des applications web en mode développement (hot-reload) et production (optimisé). Ce module est essentiel pour transformer le code source JavaScript/React en bundles optimisés pour le navigateur ou d'autres environnements cibles.

## Structure du module

- **Service principal** : Gère les requêtes pour démarrer/arrêter les serveurs de développement et compiler les bundles
- **Dev-server** : Serveur de développement avec hot-reload pour une expérience de développement fluide
- **Prod-server** : Serveur de production pour générer des bundles optimisés
- **Configuration Webpack** : Fournit des configurations par défaut et personnalisables pour Webpack
- **Configuration Babel** : Définit les presets et plugins Babel pour la transpilation

## Fonctionnement global

Le module fonctionne en deux modes principaux :

1. **Mode développement** : Lance un serveur de développement avec hot-reload qui surveille les modifications de fichiers et recompile automatiquement
2. **Mode production** : Compile les sources en bundles optimisés et minifiés pour le déploiement

Dans les deux cas, le module utilise des processus enfants (fork) pour exécuter les tâches de compilation, ce qui permet d'isoler le processus de compilation du reste de l'application.

## Exemples d'utilisation

### Démarrer un serveur de développement

```javascript
// Démarrer un serveur de développement pour un module goblin
const webpack = this.quest.getAPI('webpack');
const port = await webpack.serverStart({
  goblin: 'myapp',
  mainGoblinModule: 'goblin-myapp',
  jobId: this.quest.uuidV4(),
  port: 8080,
  options: {
    target: 'web',
    sourceMap: true,
  },
});
console.log(`Serveur de développement démarré sur le port ${port}`);
```

### Compiler pour la production

```javascript
// Compiler un bundle pour la production
const webpack = this.quest.getAPI('webpack');
await webpack.pack({
  goblin: 'myapp',
  mainGoblinModule: 'goblin-myapp',
  jobId: this.quest.uuidV4(),
  releasePath: '/path/to/release',
  outputPath: '/path/to/output',
  options: {
    sourceMap: false,
    target: 'web',
  },
});
console.log('Bundle compilé avec succès');
```

## Interactions avec d'autres modules

- **[xcraft-core-busclient]** : Pour la communication entre les processus
- **[xcraft-core-goblin]** : Pour l'enregistrement des quêtes et la gestion de l'état
- **[xcraft-core-fs]** : Pour les opérations sur le système de fichiers
- **[xcraft-core-host]** : Pour obtenir le chemin du projet
- **[xcraft-core-process]** : Pour la gestion des processus enfants

## Configuration avancée

Le module permet une configuration avancée de Webpack via un fichier `.webpack-config.js` dans le dossier `lib` du module goblin concerné. Ce fichier peut exporter une fonction qui retourne un objet de configuration personnalisé.

### Variables d'environnement

| Variable                       | Description                            | Exemple            | Valeur par défaut |
| ------------------------------ | -------------------------------------- | ------------------ | ----------------- |
| `NODE_ENV`                     | Définit l'environnement de compilation | `production`       | `development`     |
| `GOBLIN_WEBPACK_RELEASEPATH`   | Chemin vers le dossier de release      | `/path/to/release` | -                 |
| `GOBLIN_WEBPACK_NO_DEV_SERVER` | Désactive le serveur de développement  | `true`             | `false`           |

## Détails des sources

### `service.js`

Ce fichier définit le service Goblin principal qui expose les quêtes pour interagir avec Webpack. Il gère le démarrage et l'arrêt des serveurs de développement, ainsi que la compilation des bundles pour la production.

#### Méthodes publiques

- **`pack({goblin, mainGoblinModule, jobId, releasePath, outputPath, debugPath, options, withIndexHTML})`** - Compile un bundle pour la production avec les options spécifiées.
- **`server.start({goblin, mainGoblinModule, jobId, port, inspectPort, options})`** - Démarre un serveur de développement avec hot-reload.
- **`server.stop({goblin})`** - Arrête un serveur de développement en cours d'exécution.
- **`dist({outputPath, debugPath})`** - Compile un bundle pour la distribution avec des options prédéfinies.

### `dev-server.js`

Ce fichier implémente le serveur de développement avec hot-reload. Il utilise `webpack-dev-middleware` et `webpack-hot-middleware` pour fournir une expérience de développement fluide avec rechargement automatique du code modifié.

Le serveur de développement :

1. Configure Webpack avec les options spécifiées
2. Ajoute le client hot-reload aux entrées
3. Démarre un serveur Express qui sert les fichiers compilés
4. Surveille les modifications de fichiers et recompile automatiquement

### `prod-server.js`

Ce fichier implémente le serveur de production qui compile les bundles optimisés pour le déploiement. Il configure Webpack avec les options spécifiées et lance la compilation.

Le serveur de production :

1. Configure Webpack avec les options spécifiées
2. Désactive les source maps si nécessaire
3. Compile le bundle avec optimisation
4. Génère des statistiques de bundle si un chemin de débogage est spécifié

### `webpack-config.js`

Ce fichier définit la configuration Webpack par défaut et fournit des fonctions pour la personnaliser. Il gère les différences entre les configurations de développement et de production.

La configuration par défaut inclut :

- Support pour les fichiers JSX via SWC (un transpileur Rust plus rapide que Babel)
- Support pour les modules Node.js
- Support pour les fichiers CSS
- Support pour les fichiers d'assets (images, polices, etc.)
- Configuration des plugins pour l'optimisation des images
- Configuration des plugins pour la minification du code

### `babel.config.js`

Ce fichier définit la configuration Babel pour la transpilation du code JavaScript. Il inclut les presets et plugins nécessaires pour supporter les fonctionnalités modernes de JavaScript et React.

La configuration Babel inclut :

- Preset React pour la transpilation JSX
- Support pour les propriétés de classe
- Support pour le spread d'objets
- Support pour la liaison de fonction
- Transformation des modules ES en CommonJS
- Support pour l'optimisation de lodash via babel-plugin-lodash

## Détails des fichiers spéciaux

### `index.html`

Ce fichier est utilisé comme template HTML pour les applications web. Il est copié dans le dossier de sortie lors de la compilation.

### `.webpack-config.js` (dans les modules clients)

Les modules clients peuvent fournir un fichier `.webpack-config.js` dans leur dossier `lib` pour personnaliser la configuration Webpack. Ce fichier doit exporter une fonction qui prend en paramètre le chemin vers les modules Node.js et retourne un objet de configuration.

```javascript
// Exemple de .webpack-config.js
module.exports = (nodeModules, mainGoblinModule) => {
  return {
    alias: {
      // Alias personnalisés pour les imports
      'my-module': path.resolve(nodeModules, 'my-module'),
    },
  };
};
```

## Caractéristiques techniques notables

1. **Utilisation de SWC** : Le module utilise SWC (Speedy Web Compiler) via `swc-loader` pour la transpilation, ce qui offre de meilleures performances que Babel.

2. **Support pour Monaco Editor** : Le module intègre automatiquement Monaco Editor (l'éditeur utilisé par VS Code) si le package est disponible.

3. **Optimisation d'images** : En mode production, le module utilise `image-minimizer-webpack-plugin` pour optimiser les images, avec support optionnel pour `imagemin-mozjpeg` et `imagemin-pngquant`.

4. **Gestion du cache** : En mode développement, le module utilise le cache de type filesystem de Webpack pour améliorer les performances de compilation.

5. **Polyfills automatiques** : Le module fournit automatiquement des polyfills pour les modules Node.js courants comme `path`, `util`, `assert` et `buffer`.

6. **Redémarrage automatique** : Le serveur de développement se redémarre automatiquement en cas de crash.

## Conclusion

Le module `goblin-webpack` est un composant essentiel de l'écosystème Xcraft qui simplifie la configuration et l'utilisation de Webpack. Il fournit des fonctionnalités pour le développement et la production, avec des options de personnalisation pour répondre aux besoins spécifiques des applications.

_Cette documentation a été mise à jour automatiquement._

[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-process]: https://github.com/Xcraft-Inc/xcraft-core-process
