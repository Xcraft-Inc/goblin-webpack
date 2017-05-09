'use strict';

const path = require ('path');
const Goblin = require ('xcraft-core-goblin');
const Koa = require ('koa');
const webpack = require ('webpack');
const HtmlwebpackPlugin = require ('html-webpack-plugin');
const MemoryFS = require ('memory-fs');
const goblinName = path.basename (module.parent.filename, '.js');

const mFs = new MemoryFS ();

const minimalConfig = {
  entry: null,
  output: {
    path: './',
    filename: './',
  },
};

let defaultConfig = minimalConfig;
defaultConfig.output.publicPath = '/';
defaultConfig.output.path = '/webpack/';
defaultConfig.output.filename = 'goblin.bundle.js';
defaultConfig.module = {
  loaders: [
    {
      test: /\.jsx?$/,
      loader: 'babel-loader',
      exclude: /node_modules/,
    },
    {
      test: /\.(css|ttf)$/,
      loader: 'static-loader',
    },
    {
      test: /\.(png|gif)$/,
      loader: 'file-loader',
    },
  ],
};

defaultConfig.devtool = 'inline-source-map';

defaultConfig.devServer = {
  hot: true,
  publicPath: '/',
};

// Define initial logic values
const logicState = new Goblin.Shredder ({
  stats: {},
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

    let config = {};
    config.entry = path.join (widgetPath, '/index.js');

    config.plugins = [
      new webpack.HotModuleReplacementPlugin (),
      new webpack.NamedModulesPlugin (),
      new HtmlwebpackPlugin ({
        title: goblin,
      }),
    ];

    state = state.set (`www.${goblin}`, config);
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
  const dedicatedConfig = goblin.getState ().get (`www.${goblinName}`).toJS ();

  const config = Object.assign (defaultConfig, dedicatedConfig);
  const compiler = webpack (config);

  compiler.outputFileSystem = mFs; // elle sont jolies;

  compiler.plugin ('invalid', () =>
    quest.log.warn ('compiler in state invalid')
  );
  compiler.plugin ('compile', () => quest.log.info ('compiling'));

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

  const app = new Koa ();

  app.use (function* (kNext) {
    const goblinBundle = `/goblin.bundle.js`;
    if (this.req.url === goblinBundle) {
      const content = mFs.readFileSync ('/webpack/' + goblinBundle);
      this.set ('Access-Control-Allow-Origin', '*'); // To support XHR, etc.
      this.set ('Content-Type', 'application/javascript');
      this.set ('Content-Length', content.length);
      this.body = content;
      return yield* kNext;
    }
    // yield compile
    yield quest.cmd ('laboratory.open', {
      route: this.req.url,
    });

    const content = mFs.readFileSync ('/webpack/index.html');
    this.set ('Content-Type', 'text/html; charset=utf-8');
    this.set ('Content-Length', content.length);
    this.body = content;
  });

  app.listen (3000, '127.0.0.1');
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

/*const server = new WebpackDevServer (compiler, {
    stats: {
      colors: true,
    },
    setup: app => {
      app.use ((req, res, nextMiddleware) => {
        const goblinBundle = `/goblin.bundle.js`;
        if (req.url === goblinBundle) {
          const content = mFs.readFileSync ('/webpack/' + goblinBundle);
          res.sendfile (content);
          nextMiddleware ();
          return;
        }
        quest.cmd ('laboratory.open', {
          route: req.url,
        });

        res.write (
          '<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><script type="text/javascript" charset="utf-8" src="'
        );
        res.write (`goblin.bundle.js`);
        res.write (req._parsedUrl.search || '');
        res.end ('"></script></body></html>');

        nextMiddleware ();
      });
    },
  });

  server.listen (3000, '127.0.0.1');*/
