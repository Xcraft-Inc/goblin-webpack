'use strict';

const path = require ('path');
const Goblin = require ('xcraft-core-goblin');
const webpack = require ('webpack');
const WebpackDevServer = require ('webpack-dev-server');
const MemoryFS = require ('memory-fs');
const goblinName = path.basename (module.parent.filename, '.js');

const mFs = new MemoryFS ();

const index = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>goblin</title>
    <link href="https://fonts.googleapis.com/css?family=Open+Sans:300,600|Open+Sans+Condensed:300,600&amp;v2" rel="stylesheet" type="text/css">
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/font-awesome/4.5.0/css/font-awesome.min.css">
    <style>
      body {
       color: #999;
        font-family: 'Open Sans', Helvetica, Arial, Verdana, sans-serif;
        font-weight: 300;
        margin: 0;
        padding: 0;
        user-select: none;
      }
    </style>
  </head>
  <body>
  <div id="root" />
  <script type="text/javascript" src="/main.bundle.js"></script></body>
</html>`;

mFs.writeFileSync ('/index.html', index);

const minimalConfig = {
  entry: null,
  output: {},
};

let defaultConfig = minimalConfig;
defaultConfig.output.publicPath = '/';
defaultConfig.output.path = '/';
defaultConfig.output.filename = 'main.bundle.js';
defaultConfig.context = path.resolve (__dirname, '../../');
defaultConfig.module = {
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
};

defaultConfig.devtool = 'inline-source-map';
defaultConfig.plugins = [];
defaultConfig.devServer = {
  hot: true,
  compress: true,
  publicPath: '/',
};

// Define initial logic values
const logicState = {
  stats: {},
  config: defaultConfig,
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

// Define logic handlers according rc.json
const logicHandlers = {
  pack: (state, action) => {
    return state;
  },
  'server.start': (state, action) => {
    const goblin = action.get ('goblin');

    const goblinFolderName = `goblin-${goblin}`;
    const goblinPath = require
      .resolve (goblinFolderName)
      .replace (new RegExp (`(.*[/\\\\]${goblinFolderName})[/\\\\].*`), '$1');

    const widgetPath = path.join (goblinPath, '/widgets/');
    const indexPath = path.join (widgetPath, 'index.js');
    state = state.set (`config.entry`, [indexPath]);

    const customConfig = require (path.join (
      goblinPath,
      '/lib/.webpack-config.js'
    ));

    let plugins = [
      new webpack.HotModuleReplacementPlugin (),
      new webpack.NamedModulesPlugin (),
      new webpack.NoEmitOnErrorsPlugin (),
      new webpack.EnvironmentPlugin ({
        NODE_ENV: 'development', // is overrided if defined in process.env
      }),
    ];

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
  },
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
Goblin.registerQuest (goblinName, 'pack', function (quest) {
  quest.do ();
});

Goblin.registerQuest (goblinName, 'server.start', function (
  quest,
  goblin,
  jobId,
  port
) {
  quest.do ();
  const compiledGoblin = goblin;
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

      app.use (require ('webpack-hot-middleware') (compiler));

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
