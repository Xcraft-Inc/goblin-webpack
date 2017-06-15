'use strict';

const path = require ('path');
const fs = require ('fs');
const Goblin = require ('xcraft-core-goblin');
const webpack = require ('webpack');
const WebpackDevServer = require ('webpack-dev-server');
const MemoryFS = require ('memory-fs');
const goblinName = path.basename (module.parent.filename, '.js');

const minimalConfig = {
  entry: null,
  output: {},
  plugins: [],
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
        options: {
          presets: ['env'],
        },
      },
    ],
  },
};

const config = {
  development: {},
  production: {},
};

Object.assign (config.development, minimalConfig, {
  output: {
    publicPath: '/',
    path: '/',
    filename: 'main.bundle.js',
  },
  context: path.resolve (__dirname, '../../'),
  devtool: 'inline-source-map',
  devServer: {
    hot: true,
    compress: true,
    publicPath: '/',
  },
});

Object.assign (config.production, minimalConfig, {
  output: {
    publicPath: '/',
    path: '/',
    filename: 'main.bundle.js',
  },
  context: path.resolve (__dirname, '../../'),
  devtool: 'source-map',
});

// Define initial logic values
const logicState = {
  stats: {},
  config: config[process.env.NODE_ENV || 'development'],
  www: {},
  public: {},
};

let servers = new Goblin.Shredder ({});
servers.disableLogger ();

const setServer = (goblin, server) => {
  return servers.set (`${goblin}`, server);
};

const delServer = goblin => {
  return servers.del (`${goblin}`);
};

const getServer = goblin => {
  return servers.get (`${goblin}`);
};

const setWebpackState = (state, action) => {
  const goblin = action.get ('goblin');

  const goblinFolderName = `goblin-${goblin}`;
  const goblinPath = require
    .resolve (goblinFolderName)
    .replace (new RegExp (`(.*[/\\\\]${goblinFolderName})[/\\\\].*`), '$1');

  const widgetPath = path.join (goblinPath, '/widgets/');
  const indexPath = path.join (widgetPath, 'index.js');
  state = state.set (`config.entry`, [indexPath]);

  const outputPath = action.get ('outputPath');
  if (outputPath) {
    state = state.set ('config.output.path', outputPath);
  }

  const customConfig = require (path.join (
    goblinPath,
    '/lib/.webpack-config.js'
  ));

  let plugins = [
    new webpack.EnvironmentPlugin ({
      NODE_ENV: 'development', // is overrided if defined in process.env
    }),
  ];

  plugins = process.env.NODE_ENV === 'development'
    ? plugins.concat ([
        new webpack.HotModuleReplacementPlugin (),
        new webpack.NamedModulesPlugin (),
        new webpack.NoEmitOnErrorsPlugin (),
      ])
    : plugins.concat ([
        new webpack.HashedModuleIdsPlugin (),
        new webpack.optimize.UglifyJsPlugin ({
          sourceMap: true,
          mangle: false,
          beautify: false,
          comments: false,
        }),
      ]);

  if (customConfig) {
    state = state.set (`config.resolve.alias`, customConfig.alias);
  }

  // https://webpack.js.org/configuration/target/
  if (action.get ('target')) {
    state = state.set ('config.target', action.get ('target'));
  }

  if (process.versions.electron) {
    state = state.set ('config.target', 'electron-renderer');
  }

  state = state.set (`config.plugins`, plugins);
  return state;
};

// Define logic handlers according rc.json
const logicHandlers = {
  pack: setWebpackState,
  'server.start': setWebpackState,
  '_save.stats': (state, action) => {
    const goblin = action.get ('goblin');
    state = state.set (`stats.${goblin}`, action.get ('stats'));
    return state;
  },
  'save.server': (state, action) => {
    const goblin = action.get ('goblin');
    servers = setServer (goblin, action.get ('server'));
    return state;
  },
  'server.stop': (state, action) => {
    const goblin = action.get ('goblin');
    servers = delServer (goblin);
    state = state.del (`stats.${goblin}`).del (`www.${goblin}`);
    return state;
  },
};

// Register quest's according rc.json
Goblin.registerQuest (goblinName, 'pack', function* (
  quest,
  jobId,
  outputPath,
  next
) {
  quest.do ();

  try {
    fs.mkdirSync (path.join (__dirname, '../../../pack'));
  } catch (ex) {
    if (ex.code !== 'EEXIST') {
      throw ex;
    }
  }

  fs.writeFileSync (
    path.join (__dirname, '../../../pack/index.html'),
    fs.readFileSync (path.join (__dirname, 'index.html'))
  );

  const config = quest.goblin.getState ().get ('config').toJS ();

  quest.log.info (`///WEBPACK CONTEXT: ${config.context}`);
  const compiler = webpack (config);

  compiler.plugin ('compile', () => quest.log.info ('compiling'));

  compiler.plugin ('done', stats => {
    quest.log.info (`compiler ${jobId}.done`);
    quest.evt (`${jobId}.done`);
  });

  const stats = yield compiler.run (next);
  quest.log.verb (stats);

  quest.log.info ('output packed');
});

Goblin.registerQuest (goblinName, 'server.start', function (
  quest,
  goblin,
  jobId,
  port
) {
  quest.do ();
  const compiledGoblin = goblin;

  const mFs = new MemoryFS ();

  mFs.writeFileSync (
    '/index.html',
    fs.readFileSync (path.join (__dirname, 'index.html'))
  );

  const config = quest.goblin.getState ().get ('config').toJS ();

  config.entry.splice (
    0,
    0,
    'webpack-hot-middleware/client?path=/__webpack_hmr&reload=true'
  );

  quest.log.info (`///WEBPACK CONTEXT: ${config.context}`);
  const compiler = webpack (config);

  compiler.outputFileSystem = mFs; // elle sont jolies;

  //  https://webpack.js.org/api/plugins/compiler/#event-hooks
  compiler.plugin ('invalid', () =>
    quest.log.warn ('compiler in invalid state')
  );

  compiler.plugin ('compile', () => quest.log.info ('compiling'));

  compiler.plugin ('need-additional-pass', () =>
    quest.log.info ('compiler need-additional-pass')
  );

  compiler.plugin ('done', stats => {
    quest.log.info (`compiler ${jobId}.done`);
    quest.evt (`${jobId}.done`);
  });

  const server = new WebpackDevServer (compiler, {
    stats: {
      colors: true,
    },
    setup: app => {
      app.use ((req, res, next) => {
        let content;
        switch (req.url) {
          case '/':
            content = mFs.readFileSync ('/index.html');
            res.set ('Content-Type', 'text/html; charset=utf-8');
            res.set ('Content-Length', content.length);
            res.send (content);
            break;
          case '/main.bundle.js':
            content = mFs.readFileSync ('/main.bundle.js');
            res.set ('Access-Control-Allow-Origin', '*'); // To support XHR, etc.
            res.set ('Content-Type', 'application/javascript');
            res.set ('Content-Length', content.length);
            res.send (content);
            break;
          default:
            next ();
        }
      });

      if (process.env.NODE_ENV === 'development') {
        app.use (require ('webpack-hot-middleware') (compiler));
      }

      app.get ('/app/*', req =>
        quest.cmd ('laboratory.open', {
          route: req.url,
        })
      );
    },
  });

  server.listen (port, '127.0.0.1');

  quest.dispatch ('save.server', {
    goblin: compiledGoblin,
    server,
  });

  quest.log.info ('dev-server started');
});

Goblin.registerQuest (goblinName, 'server.stop', function (quest, goblin) {
  const server = getServer (goblin);
  if (server) {
    server.middleware.close ();
    server.close ();
    quest.do ();
  }
});

Goblin.registerQuest (goblinName, '_save.stats', function (quest, stats) {
  quest.do ();
  quest.log.info (stats);
});

// Singleton
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
Goblin.createSingle (goblinName);
