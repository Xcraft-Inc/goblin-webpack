'use strict';

const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const Goblin = require('xcraft-core-goblin');
const webpack = require('webpack');
const {webpackConfig, setWebpackConfig} = require('./webpack-config.js');
const goblinName = path.basename(module.parent.filename, '.js');

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
  mainGoblinModule,
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
    options.target,
    mainGoblinModule
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

Goblin.registerQuest(goblinName, 'server.start', function(
  quest,
  goblin,
  mainGoblinModule,
  jobId,
  port,
  inspectPort,
  options,
  $msg
) {
  const busClient = require('xcraft-core-busclient').getGlobal();
  const orcName = $msg.orcName;
  const xHost = require('xcraft-core-host');
  let projectPath = xHost.projectPath;

  //SPAWN ALL
  if (/[\\/]app\.asar[\\/]/.test(projectPath)) {
    /* I don't use hazardous here, because the project is broken with electron >1 */
    projectPath = projectPath.replace(/app\.asar/, 'app.asar.unpacked');
  }

  const childModule = path.join(__dirname, 'dev-server.js');

  const execOptions = {
    cwd: projectPath,
    stdio: 'inherit',
  };

  if (process.env.NODE_ENV !== 'production') {
    // Enable this line to debug the child process
    // execOptions.execArgv = [`--inspect=${inspectPort || 13229}`];
  }

  const resp = busClient.newResponse('webpack', orcName);
  const xProcess = require('xcraft-core-process')({
    logger: 'xlog',
    resp,
  });

  const restartUnsub = quest.sub('webpack.restart-server-requested', function*(
    err,
    {resp, msg}
  ) {
    yield resp.cmd(`webpack.server.start`, {id: 'webpack', ...msg.data});
    console.log('Webpack dev-server restarted!');
  });

  quest.goblin.setX('restartUnsub', restartUnsub);
  const forked = xProcess.fork(childModule, [], execOptions, () => {
    console.log('Oops 🙈, Webpack dev-server process exited, restarting...');
    quest.evt('restart-server-requested', {
      goblin,
      mainGoblinModule,
      jobId,
      port,
      inspectPort,
      options,
    });
  });

  quest.goblin.setX('process', forked);
  let msg = null;

  forked.on('message', message => {
    msg = message;
    switch (msg.type) {
      case 'job-done':
        resp.events.send(`${goblinName}.${msg.result.jobId}.done`);
        break;
      case 'error':
        quest.log.err(`Webpack dev-server error: ${msg.result.error}`);
        break;
    }
  });

  forked.send({
    goblin,
    mainGoblinModule,
    jobId,
    port,
    options,
    projectPath,
  });

  quest.dispatch('save.server', {
    goblin,
    server: forked,
  });

  quest.log.info('dev-server started');

  return port;
});

Goblin.registerQuest(goblinName, 'server.stop', function(quest, goblin) {
  const unsub = quest.goblin.getX('restartUnsub');
  if (unsub) {
    unsub();
  }
  const server = getServer(goblin);
  if (server) {
    server.kill();
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
