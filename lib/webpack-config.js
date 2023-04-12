const webpack = require('webpack');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');
const Shredder = require('xcraft-core-shredder');

class WebpackConfig {
  constructor() {
    this._config = {};
  }

  build(appName, options) {
    const {target, publicPath} = options;

    this._config = {
      development: {},
      production: {},
    };

    const minimalConfig = {
      entry: null,
      output: {
        publicPath: publicPath ?? (target === 'web' ? '/' : ''),
        path:
          process.env.NODE_ENV === 'development'
            ? path.join(os.tmpdir(), '.cache/devpack', appName || 'default')
            : '/',
        filename: 'main.bundle.js',
        pathinfo: false,
      },
      module: {
        exprContextCritical: false /* Added for power-asset */,
        rules: [
          {
            test: /\.jsx?$/,
            exclude: /node_modules[\\/](?!((electrum-|goblin-|xcraft-)[-0-9a-z]+)[\\/])/,
            use: [
              {
                loader: 'swc-loader',
                options: {
                  jsc: {
                    parser: {
                      syntax: 'ecmascript',
                      jsx: true,
                      dynamicImport: true,
                      privateMethod: true,
                      functionBind: true,
                      exportDefaultFrom: true,
                      exportNamespaceFrom: true,
                      decorators: false,
                      decoratorsBeforeExport: false,
                      topLevelAwait: false,
                      importMeta: false,
                    },
                    transform: null,
                    target: 'es2015',
                    loose: false,
                    externalHelpers: false,
                    // Requires v1.2.50 or upper and requires target to be es2016 or upper.
                    keepClassNames: true,
                  },
                  minify: false,
                },
              },
            ],
          },
          {
            test: /\.node$/,
            loader: 'node-loader',
            options: {
              name: '[path][contenthash].[ext]',
            },
          },
          {
            test: /\.md$/,
            type: 'asset/source',
          },
          {
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
          },
          {
            test: /\.(png|jpg|gif|ico|svg|eot|ttf|woff|woff2)$/,
            type: 'asset/resource',
          },
        ],
      },
    };

    Object.assign(this._config.development, minimalConfig, {
      mode: 'development',
      devtool: 'eval-cheap-module-source-map',
      optimization: {
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
      },
      cache: {
        type: 'filesystem',
        cacheDirectory: path.join(
          os.tmpdir(),
          '.cache/webpack',
          appName || 'default'
        ),
      },
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

    const contextPath = releasePath
      ? path.join(releasePath, 'node_modules')
      : path.resolve(__dirname, '../../');

    let state = new Shredder();
    state = state
      .set('', webpackConfig.config[process.env.NODE_ENV || 'development'])
      .set('context', contextPath)
      .set(`entry`, [indexPath])
      .set('resolve.fallback', {
        path: require.resolve('path-browserify'),
        util: require.resolve('util/'),
        assert: require.resolve('assert/'),
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
      new webpack.ProvidePlugin({
        process: 'process/browser.js',
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

      const minimizerPlugins = [];
      try {
        if (require.resolve('imagemin-mozjpeg')) {
          minimizerPlugins.push(['mozjpeg', {}]);
        }
      } catch (ex) {
        /* ignored, it's optional */
      }
      try {
        if (require.resolve('imagemin-pngquant')) {
          minimizerPlugins.push(['pngquant', {}]);
        }
      } catch (ex) {
        /* ignored, it's optional */
      }

      plugins.push(
        new ImageMinimizerPlugin({
          minimizerOptions: {
            plugins: minimizerPlugins,
          },
        })
      );

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
