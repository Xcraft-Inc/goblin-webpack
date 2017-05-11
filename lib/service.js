'use strict';

const path = require ('path');
const watt = require ('watt');
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
defaultConfig.module = {
  rules: [
    {
      test: /\.jsx?$/,
      exclude: /node_modules/,
      loader: 'babel-loader',
      options: {},
    },
  ],
};

defaultConfig.devtool = 'inline-source-map';
defaultConfig.plugins = [
  new webpack.HotModuleReplacementPlugin (),
  new webpack.NamedModulesPlugin (),
  new webpack.NoEmitOnErrorsPlugin (),
];
defaultConfig.devServer = {
  hot: true,
  compress: true,
  publicPath: '/',
};

// Define initial logic values
const logicState = new Goblin.Shredder ({
  stats: {},
  config: defaultConfig,
  www: {},
  public: {},
});

let compilers = new Goblin.Shredder ({});

const setCompiler = (goblin, compiler) => {
  return compilers.set (`${goblin}`, compiler);
};

const delCompiler = goblin => {
  return compilers.del (`${goblin}`);
};

let watchers = new Goblin.Shredder ({});

const setWatcher = (goblin, watcher) => {
  return watchers.set (`${goblin}`, watcher);
};

const delWatcher = goblin => {
  return watchers.del (`${goblin}`);
};

const getWatcher = (goblin, watcher) => {
  return watchers.get (`${goblin}`, watcher);
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

    state = state
      .set (`config.entry`, ['./index.js'])
      .set ('config.context', widgetPath);

    const customConfig = require (path.join (
      goblinPath,
      '/lib/.webpack-config.js'
    ));
    if (customConfig) {
      state = state.set (`config.resolve.alias`, customConfig.alias);
    }
    return state;
  },
  'save.compiler': (state, action) => {
    compilers = setCompiler (goblin, action.get ('compiler'));
    return state;
  },
  '_save.stats': (state, action) => {
    const goblin = action.get ('goblin');
    state = state.set (`stats.${goblin}`, action.get ('stats'));
    return state;
  },
  'save.watcher': (state, action) => {
    const goblin = action.get ('goblin');
    watchers = setWatcher (goblin, action.get ('watcher'));
    return state;
  },
  'server.stop': (state, action) => {
    const goblin = action.get ('goblin');
    watchers = delWatcher (goblin);
    compilers = delCompiler (goblin);
    state = state.del (`stats.${goblin}`).del (`www.${goblin}`);
    return state;
  },
};

// Create a Goblin with initial state and handlers
const goblin = new Goblin (goblinName, logicState, logicHandlers);

// Register quest's according rc.json
goblin.registerQuest ('pack', function (quest) {
  quest.goblin.do ({win});
});

goblin.registerQuest ('server.start', function* (quest, msg, next) {
  quest.goblin.do ();
  const goblinName = msg.get ('goblin');
  const config = goblin.getState ().get ('config').toJS ();

  config.entry.splice (
    0,
    0,
    'webpack-hot-middleware/client?path=/__webpack_hmr'
  );

  const compiler = webpack (config);

  compiler.outputFileSystem = mFs; // elle sont jolies;

  compiler.plugin ('invalid', () =>
    quest.log.warn ('compiler in state invalid')
  );

  compiler.plugin ('compile', () => {
    quest.log.info ('compiling');
  });

  compiler.plugin ('done', stats => {
    quest.evt (`${goblinName}.done`);
  });

  quest.dispatch ('save.compiler', {
    goblin: goblinName,
    compiler,
  });

  const watcher = compiler.watch (
    {
      ignored: /node_modules/,
    },
    (err, stats) => {
      quest.cmd ('webpack._save.stats', {
        goblin: goblinName,
        stats: stats.toString ('minimal'),
      });
    }
  );

  quest.dispatch ('save.watcher', {
    goblin: goblinName,
    watcher,
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

  server.listen (3000, '127.0.0.1');

  quest.log.info ('dev-server started');
});

goblin.registerQuest ('server.stop', function (quest, msg) {
  const watcher = getWatcher (msg.get ('goblin'));
  if (watcher) {
    watcher.close ();
  }
  quest.goblin.do ();
});

goblin.registerQuest ('_save.stats', function (quest, msg) {
  quest.goblin.do ();
  const stats = msg.get ('stats');
  quest.log.info (stats);
});

module.exports = goblin.quests;
