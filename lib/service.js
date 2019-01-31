'use strict';

const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const Goblin = require('xcraft-core-goblin');
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const MinifyPlugin = require('babel-minify-webpack-plugin');
const HardSourceWebpackPlugin = require('hard-source-webpack-plugin');
const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');
const MomentLocalesPlugin = require('moment-locales-webpack-plugin');
const MemoryFS = require('memory-fs');

const goblinName = path.basename(module.parent.filename, '.js');

class WebpackConfig {
  constructor() {
    this._config = {};
  }

  build(target) {
    let targets = {};
    let useBuiltIns = false;

    if (target.startsWith('electron')) {
      targets = {
        electron: '4.0',
      };
      useBuiltIns = false;
    } else if (target.startsWith('node')) {
      targets = {
        node: '8',
      };
      useBuiltIns = false;
    } else {
      targets = {
        browsers: 'defaults',
      };
      useBuiltIns = true;
    }

    const env = [
      'env',
      {
        targets,
        debug: process.env.NODE_ENV !== 'production',
        useBuiltIns,
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
        path: '/',
        filename: 'main.bundle.js',
      },
      module: {
        rules: [
          {
            test: /\.jsx?$/,
            exclude: /node_modules[\\/](?!(obj-to-css|(electrum-|goblin-|xcraft-)[-0-9a-z]+)[\\/])/,
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
                  presets: ['react', env],
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
                options: {
                  limit: 10000,
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
      devServer: {
        hot: true,
        compress: true,
        publicPath: '/',
        historyApiFallback: true,
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

// Define initial logic values
const logicState = {
  stats: {},
  www: {},
  public: {},
};

let servers = new Goblin.Shredder({});
servers.disableLogger();

const setServer = (goblin, server) => {
  return servers.set(`${goblin}`, server);
};

const delServer = goblin => {
  return servers.del(`${goblin}`);
};

const getServer = goblin => {
  return servers.get(`${goblin}`);
};

const setWebpackConfig = (
  goblin,
  releasePath,
  outputPath,
  debugPath,
  target
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
    entry = ['babel-polyfill', 'react-hot-loader/patch', 'react', 'react-dom'];
  }

  const contextPath = releasePath
    ? path.join(releasePath, 'node_modules')
    : path.resolve(__dirname, '../../');

  let state = new Goblin.Shredder();
  state = state
    .set('', webpackConfig.config[process.env.NODE_ENV || 'development'])
    .set('context', contextPath)
    .set(`entry`, entry.concat(indexPath));

  if (outputPath) {
    state = state.set('output.path', outputPath);
  }

  const nodeModules = path.resolve(releasePath || '.', 'node_modules');
  const customConfig = require(path.join(
    goblinPath,
    '/lib/.webpack-config.js'
  ))(nodeModules);

  let plugins = [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development', // is overrided if defined in process.env
    }),
    new MomentLocalesPlugin({
      localesToKeep: ['fr', 'fr-ch', 'de', 'de-ch', 'it'],
    }),
  ];

  if (process.env.NODE_ENV !== 'production') {
    plugins = plugins.concat([
      // FIXME: HardSource is no longer working correctly (event 0.12 version)
      /*new HardSourceWebpackPlugin({
            cacheDirectory: path.join(
              nodeModules,
              '.cache/hard-source/[confighash]'
            ),
          }),*/
      new webpack.HotModuleReplacementPlugin(),
    ]);
  } else {
    plugins = plugins.concat([
      new webpack.HashedModuleIdsPlugin(),
      new MinifyPlugin({
        mangle: {
          keepFnName: true, // function names needed since index-ws.js addition
          keepClassName: true, // needed for constructor.name attribute
        },
        simplify: true,
      }),
    ]);

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
};

// Define logic handlers according rc.json
const logicHandlers = {
  '_save.stats': (state, action) => {
    const goblin = action.get('goblin');
    state = state.set(`stats.${goblin}`, action.get('stats'));
    return state;
  },
  'save.server': (state, action) => {
    const goblin = action.get('goblin');
    servers = setServer(goblin, action.get('server'));
    return state;
  },
  'server.stop': (state, action) => {
    const goblin = action.get('goblin');
    servers = delServer(goblin);
    state = state.del(`stats.${goblin}`).del(`www.${goblin}`);
    return state;
  },
};

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'pack', function*(
  quest,
  goblin,
  jobId,
  releasePath,
  outputPath,
  debugPath,
  options,
  next
) {
  webpackConfig.build(options.target);

  const cfg = setWebpackConfig(
    goblin,
    releasePath,
    outputPath,
    debugPath,
    options.target
  );
  quest.goblin.setX('config', cfg);
  const config = cfg.toJS();

  try {
    fs.mkdirSync(outputPath);
  } catch (ex) {
    if (ex.code !== 'EEXIST') {
      throw ex;
    }
  }

  fs.writeFileSync(
    path.join(outputPath, 'index.html'),
    fs.readFileSync(path.join(__dirname, 'index.html'))
  );

  /* Remove source-map when building a release (public) */
  if (!options.sourceMap) {
    config.devtool = false;
  }

  if (options.indexFile) {
    // Patch index.js entry
    config.entry = config.entry.map(e =>
      e.endsWith('index.js') ? e.replace('index.js', options.indexFile) : e
    );
  }

  if (options.target) {
    config.target = options.target;
  }

  quest.log.info(`///WEBPACK CONTEXT: ${config.context}`);
  const compiler = webpack(config);

  compiler.plugin('compile', () => quest.log.info('compiling'));

  compiler.plugin('done', () => {
    quest.log.info(`compiler ${jobId}.done`);
    quest.evt(`${jobId}.done`);
  });

  const stats = yield compiler.run(next);

  stats.compilation.errors.forEach(err => {
    quest.log.err(err.stack);
  });

  quest.log.info('output packed');

  if (fse.existsSync(path.join(outputPath, config.output.filename))) {
    /* Copy the bundle.js file next to the stats.json file */
    fse.copySync(
      path.join(outputPath, config.output.filename),
      path.join(debugPath, config.output.filename)
    );
  }
});

Goblin.registerQuest(goblinName, 'server.start', function*(
  quest,
  goblin,
  jobId,
  port,
  options,
  next
) {
  webpackConfig.build(options.target);

  const cfg = setWebpackConfig(goblin, null, null, null, options.target);
  quest.goblin.setX('config', cfg);
  const config = cfg.toJS();

  const compiledGoblin = goblin;

  const mFs = new MemoryFS();

  mFs.writeFileSync(
    '/index.html',
    fs.readFileSync(path.join(__dirname, 'index.html'))
  );

  if (options.target) {
    config.target = options.target;
  }

  if (options.indexFile) {
    // Patch index.js entry
    config.entry = config.entry.map(e =>
      e.endsWith('index.js') ? e.replace('index.js', options.indexFile) : e
    );
  }

  config.entry.splice(
    0,
    0,
    `webpack-hot-middleware/client?path=//localhost:${port}/__webpack_hmr&reload=true`
  );

  quest.log.info(`///WEBPACK CONTEXT: ${config.context}`);
  const compiler = webpack(config);

  compiler.outputFileSystem = mFs; // elle sont jolies;

  //  https://webpack.js.org/api/plugins/compiler/#event-hooks
  compiler.hooks.invalid.tap({name: 'goblin webpack'}, () =>
    quest.log.warn('compiler in invalid state')
  );

  compiler.hooks.compile.tap({name: 'goblin webpack'}, () =>
    quest.log.info('compiling')
  );

  compiler.hooks.done.tap({name: 'goblin webpack'}, () => {
    quest.log.info(`compiler ${jobId}.done`);
    quest.evt(`${jobId}.done`);
  });

  const server = new WebpackDevServer(compiler, {
    stats: {
      colors: true,
    },
    before: app => {
      app.use((req, res, next) => {
        let content;
        switch (req.url) {
          case '/':
            content = mFs.readFileSync('/index.html');
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Content-Length', content.length);
            res.send(content);
            break;
          case `/${config.output.filename}`:
            content = mFs.readFileSync(`/${config.output.filename}`);
            res.set('Access-Control-Allow-Origin', '*'); // To support XHR, etc.
            res.set('Content-Type', 'application/javascript');
            res.set('Content-Length', content.length);
            res.send(content);
            break;
          default:
            next();
        }
      });

      if (process.env.NODE_ENV !== 'production') {
        app.use(require('webpack-hot-middleware')(compiler));
      }

      app.get('/app/*', req =>
        quest.cmd('laboratory.open', {
          route: req.url,
        })
      );
    },
  });

  while (port < 65536) {
    try {
      yield server.listen(port, '127.0.0.1', next.arg(0)).on('error', next);
      break;
    } catch (ex) {
      if (options.autoinc && /^(EADDRINUSE|EACCES)$/.test(ex.code)) {
        ++port;
      } else {
        throw ex;
      }
    }
  }

  quest.dispatch('save.server', {
    goblin: compiledGoblin,
    server,
  });

  quest.log.info('dev-server started');

  return port;
});

Goblin.registerQuest(goblinName, 'server.stop', function(quest, goblin) {
  const server = getServer(goblin);
  if (server) {
    server.middleware.close();
    server.close();
    quest.do();
  }
});

Goblin.registerQuest(goblinName, 'dist', function*(
  quest,
  outputPath,
  debugPath
) {
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  yield quest.me.pack({
    goblin: 'laboratory',
    jobId: quest.goblin.id,
    outputPath,
    debugPath,
    options: {
      sourceMap: false,
      indexFile: 'index-browsers.js',
      target: 'web',
    },
  });

  process.env.NODE_ENV = nodeEnv;
});

Goblin.registerQuest(goblinName, '_save.stats', function(quest, stats) {
  quest.do();
  quest.log.info(stats);
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
