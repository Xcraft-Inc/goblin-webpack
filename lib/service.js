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
  <script type="text/javascript" src="/goblin.bundle.js"></script></body>
</html>`;

mFs.writeFileSync ('/index.html', index);

const minimalConfig = {
  entry: null,
  output: {},
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
    config.entry = [path.join (widgetPath, '/index.js')];

    config.plugins = [
      new webpack.HotModuleReplacementPlugin (),
      new webpack.NamedModulesPlugin (),
      new webpack.NoEmitOnErrorsPlugin (),
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
            quest.cmd ('laboratory.open', {
              route: req.url,
            });
            content = mFs.readFileSync ('/index.html');
            res.set ('Content-Type', 'text/html; charset=utf-8');
            res.set ('Content-Length', content.length);
            res.send (content);
            break;
          case '/goblin.bundle.js':
            content = mFs.readFileSync ('/webpack/goblin.bundle.js');
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

/*const app = new Koa ();

  app.use (ctx => {
    const goblinBundle = `/goblin.bundle.js`;
    if (ctx.req.url === goblinBundle) {
      const content = mFs.readFileSync ('/webpack/' + goblinBundle);
      ctx.set ('Access-Control-Allow-Origin', '*'); // To support XHR, etc.
      ctx.set ('Content-Type', 'application/javascript');
      ctx.set ('Content-Length', content.length);
      ctx.body = content;
      return;
    }

    quest.cmd ('laboratory.open', {
      route: ctx.req.url,
    });

    const content = mFs.readFileSync ('/index.html');
    ctx.set ('Content-Type', 'text/html; charset=utf-8');
    ctx.set ('Content-Length', content.length);
    ctx.body = content;
  });

  app.use (hotWare (compiler, {publicPath: config.output.publicPath}));

  app.listen (3000, '127.0.0.1');*/
/*const hotHandler = createHotMiddleware (compiler);
  const hotMiddleware = ctx =>
    watt (function* (wNext) {
      yield hotHandler (ctx.req, ctx.res, wNext);
    });

  app.use (function* (kNext) {
    yield hotMiddleware (this) ();
    return yield* kNext;
  });*/

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
