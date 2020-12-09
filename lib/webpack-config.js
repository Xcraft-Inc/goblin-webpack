const webpack = require('webpack');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');
const Goblin = require('xcraft-core-goblin');

class WebpackConfig {
  constructor() {
    this._config = {};
  }

  build(appName, target) {
    let targets = {};
    let useBuiltIns = false;

    if (target.startsWith('electron')) {
      targets = {
        electron: '11',
      };
      useBuiltIns = false;
    } else if (target.startsWith('node')) {
      targets = {
        node: '12',
      };
      useBuiltIns = false;
    } else {
      targets = {
        browsers: 'defaults',
      };
      useBuiltIns = 'usage';
    }

    const env = [
      '@babel/preset-env',
      {
        targets,
        debug: process.env.NODE_ENV === 'development',
        useBuiltIns,
        corejs: '3',
      },
    ];

    this._config = {
      development: {},
      production: {},
    };

    const minimalConfig = {
      entry: null,
      output: {
        publicPath: '',
        path:
          process.env.NODE_ENV === 'development'
            ? path.join(os.tmpdir(), '.cache/devpack', appName || 'default')
            : '/',
        filename: 'main.bundle.js',
      },
      module: {
        rules: [
          {
            test: /\.jsx?$/,
            exclude: /node_modules[\\/](?!((electrum-|goblin-|xcraft-)[-0-9a-z]+)[\\/])/,
            loader: 'babel-loader',
            options: {
              plugins: ['lodash'],
              presets: [env],
            },
          },
          {
            test: /\.md$/,
            use: [
              {
                loader: 'babel-loader',
                options: {
                  presets: ['@babel/preset-react', env],
                },
              },
            ],
          },
          {
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
          },
          {
            test: /\.(png|jpg|gif|svg|eot|ttf|woff|woff2)$/,
            use: [
              {
                loader: 'url-loader',
                // Fallback to file-loader with name [hash].[ext] with md5 hash. This is used by the backend-renderer.
                options: {
                  limit: 10000,
                  fallback: 'file-loader',

                  // Fallback options
                  outputPath: target === 'web' ? '/assets' : undefined,
                  name: '[hash].[ext]',
                },
              },
            ],
          },
        ],
      },
    };

    Object.assign(this._config.development, minimalConfig, {
      mode: 'development',
      devtool: 'inline-source-map',
    });

    // Fix HMR with web worker
    this._config.development.output.globalObject = `(typeof self !== 'undefined' ? self : this)`;

    Object.assign(this._config.production, minimalConfig, {
      mode: 'production',
      devtool: 'source-map',
      optimization: {
        minimize: false,
      },
    });
  }

  get config() {
    return this._config;
  }
}

const webpackConfig = new WebpackConfig();

module.exports = {
  setWebpackConfig: (
    goblin,
    releasePath,
    outputPath,
    debugPath,
    target,
    mainGoblinModule
  ) => {
    const goblinFolderName = `goblin-${goblin}`;
    const goblinPath = releasePath
      ? path.join(releasePath, 'node_modules', goblinFolderName)
      : require
          .resolve(path.join(goblinFolderName, 'package.json'))
          .replace(new RegExp(`(.*[/\\\\]${goblinFolderName})[/\\\\].*`), '$1');

    const widgetPath = path.join(goblinPath, '/widgets/');
    const indexPath = path.join(widgetPath, 'index.js');

    let entry = [];

    /* HACK: workaround for IE11 bug with React
     * - https://stackoverflow.com/questions/40897966/objects-are-not-valid-as-a-react-child-in-internet-explorer-11-for-react-15-4-1
     * - https://github.com/facebook/react/issues/8379
     */
    if (target === 'web') {
      entry = ['react', 'react-dom'];
    }

    const contextPath = releasePath
      ? path.join(releasePath, 'node_modules')
      : path.resolve(__dirname, '../../');

    let state = new Goblin.Shredder();
    state = state
      .set('', webpackConfig.config[process.env.NODE_ENV || 'development'])
      .set('context', contextPath)
      .set(`entry`, entry.concat(indexPath))
      .set('resolve.fallback', {
        path: require.resolve('path-browserify'),
        util: require.resolve('util/'),
      });

    if (outputPath) {
      state = state.set('output.path', outputPath);
    }

    const nodeModules = path.resolve(
      releasePath || path.join(__dirname, '../../..'),
      'node_modules'
    );

    const userWebpackConfig = path.join(goblinPath, '/lib/.webpack-config.js');
    let customConfig;
    if (fs.existsSync(userWebpackConfig)) {
      customConfig = require(userWebpackConfig)(nodeModules, mainGoblinModule);
    }

    const plugins = [
      new webpack.EnvironmentPlugin({
        NODE_ENV: 'development', // is overrided if defined in process.env
        NODE_DEBUG: '',
      }),
    ];

    try {
      const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
      plugins.push(
        new MonacoWebpackPlugin({languages: ['typescript', 'javascript']})
      );
    } catch (ex) {
      if (ex.code !== 'MODULE_NOT_FOUND') {
        throw ex;
      }
    }

    if (process.env.NODE_ENV === 'development') {
      plugins.push(new webpack.HotModuleReplacementPlugin());
    } else {
      if (debugPath) {
        plugins.push(
          new BundleAnalyzerPlugin({
            analyzerMode: 'disabled',
            openAnalyzer: false,
            generateStatsFile: true,
            statsFilename: path.join(debugPath, 'stats.json'),
          })
        );
      }

      state = state
        .set('optimization.minimize', true)
        .set('optimization.minimizer', [
          new TerserPlugin({
            terserOptions: {
              keep_classnames: true,
              keep_fnames: target === 'web',
            },
          }),
        ])
        .set('optimization.moduleIds', 'deterministic');
    }

    if (customConfig) {
      state = state.set(`resolve.alias`, customConfig.alias);
    }

    // https://webpack.js.org/configuration/target/
    if (target) {
      state = state.set('target', target);
    }

    state = state.set(`plugins`, plugins);
    return state;
  },
  webpackConfig,
};
