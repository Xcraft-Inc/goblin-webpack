'use strict';

const path = require ('path');
const Goblin = require ('xcraft-core-goblin');
const webpack = require ('webpack');
const MemoryFS = require ('memory-fs');
const goblinName = path.basename (module.parent.filename, '.js');

const mFs = new MemoryFS ();
mFs.mkdirpSync ('/outputs/');
const minimalConfig = {
  entry: null,
  output: {
    path: './',
    filename: './',
  },
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
    const config = minimalConfig;
    const goblinFolderName = `goblin-${action.get ('goblin')}`;
    const goblinPath = require
      .resolve (goblinFolderName)
      .replace (new RegExp (`(.*[/\\\\]${goblinFolderName})[/\\\\].*`), '$1');

    config.entry = path.join (goblinPath, '/widgets/index.js');
    config.output.path = '/webpack/';
    config.output.filename = 'goblin.bundle.js';
    state = state.set (`www.${action.get ('goblin')}`, config);
    return state;
  },
  'save.compiler': (state, action) => {
    compilers = setCompiler (action.get ('goblin'), action.get ('compiler'));
    return state;
  },
  '_save.stats': (state, action) => {
    state = state.set (`stats.${action.get ('goblin')}`, action.get ('stats'));
    return state;
  },
  'save.watcher': (state, action) => {
    watchers = setWatcher (action.get ('goblin'), action.get ('watcher'));
    return state;
  },
  'server.stop': (state, action) => {
    watchers = delWatcher (action.get ('goblin'));
    compilers = delCompiler (action.get ('goblin'));
    state = state
      .del (`stats.${action.get ('goblin')}`)
      .del (`www.${action.get ('goblin')}`);
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
  const config = goblin.getState ().get (`www.${goblinName}`).toJS ();

  const compiler = webpack (config);

  compiler.outputFileSystem = mFs; // elle sont jolies;
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
        stats: stats.toJson ('minimal'),
      });
      /*quest.dispatch ('save.stats', {
        goblin: goblinName,
        stats: stats.toJson ('minimal'),
      });*/
    }
  );

  quest.dispatch ('save.watcher', {
    goblin: goblinName,
    watcher,
  });
});

goblin.registerQuest ('server.stop', function (quest, msg) {
  const watcher = getWatcher (msg.get ('goblin'));
  if (watcher) {
    watcher.close ();
  }
  quest.goblin.do ();
});

goblin.registerQuest ('_save.stats', function (quest) {
  quest.goblin.do ();
});

module.exports = goblin.quests;
