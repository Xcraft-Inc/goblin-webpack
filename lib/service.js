'use strict';

const path = require('path');
const Goblin = require('xcraft-core-goblin');
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

const delServer = (goblin) => {
  return servers.del(`${goblin}`);
};

const getServer = (goblin) => {
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

Goblin.registerQuest(goblinName, 'pack', function* (
  quest,
  goblin,
  mainGoblinModule,
  jobId,
  releasePath,
  outputPath,
  debugPath,
  options,
  withIndexHTML = true,
  next
) {
  const xHost = require('xcraft-core-host');
  let projectPath = xHost.projectPath;

  //SPAWN ALL
  if (/[\\/]app\.asar[\\/]/.test(projectPath)) {
    /* I don't use hazardous here, because the project is broken with electron >1 */
    projectPath = projectPath.replace(/app\.asar/, 'app.asar.unpacked');
  }

  const childModule = path.join(__dirname, 'prod-server.js');

  const execOptions = {
    cwd: projectPath,
    stdio: 'pipe',
  };

  const xProcess = require('xcraft-core-process')({
    logger: 'xlog',
    resp: quest.resp,
  });

  const forked = xProcess.fork(childModule, [], execOptions, next.parallel());

  let msg = null;

  forked.on('message', (message) => {
    msg = message;
    switch (msg.type) {
      case 'job-done':
        quest.evt(`${jobId}.done`);
        break;
      case 'error':
        quest.log.err(
          `Webpack prod-server error: ${
            msg.result.error.stack ||
            msg.result.error.message ||
            msg.result.error
          }`
        );
        break;
    }
  });

  forked.send({
    goblin,
    mainGoblinModule,
    jobId,
    releasePath,
    outputPath,
    debugPath,
    options,
    withIndexHTML,
    projectPath,
  });

  yield next.sync();
});

Goblin.registerQuest(goblinName, 'server.start', function (
  quest,
  goblin,
  mainGoblinModule,
  jobId,
  port,
  inspectPort,
  options,
  $msg
) {
  const cwd = process.cwd();
  process.chdir(path.join(__dirname, '..'));
  quest.defer(() => process.chdir(cwd));

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
    stdio: 'pipe',
  };

  const resp = busClient.newResponse('webpack', orcName);
  const xProcess = require('xcraft-core-process')({
    logger: 'xlog',
    resp,
  });

  const restartUnsub = quest.sub('webpack.restart-server-requested', function* (
    err,
    {resp, msg}
  ) {
    restartUnsub();
    quest.goblin.delX('restartUnsub');
    yield resp.cmd(`webpack.server.start`, {id: 'webpack', ...msg.data});
    resp.log.dbg('Webpack dev-server restarted!');
  });

  quest.goblin.setX('restartUnsub', restartUnsub);

  const forked = xProcess.fork(childModule, [], execOptions, () => {
    quest.log.dbg('Oops 🙈, Webpack dev-server process exited, restarting...');
    try {
      process.kill(forked.pid);
    } catch (ex) {
      /* ignore */
    }
    quest.evt('restart-server-requested', {
      goblin,
      mainGoblinModule,
      jobId,
      port,
      inspectPort,
      options,
    });
  });

  let msg = null;

  forked.on('message', (message) => {
    msg = message;
    switch (msg.type) {
      case 'job-done':
        resp.events.send(`${goblinName}.${msg.result.jobId}.done`);
        break;
      case 'error':
        quest.log.err(
          `Webpack dev-server error: ${
            msg.result.error.stack ||
            msg.result.error.message ||
            msg.result.error
          }`
        );
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

  const killUnsub = quest.sub('greathall::shutdown', () => {
    try {
      process.kill(forked.pid);
    } catch (ex) {
      /* ignore */
    }
  });
  quest.goblin.setX('killUnsub', killUnsub);

  quest.log.info('dev-server started');

  return port;
});

Goblin.registerQuest(goblinName, 'server.stop', function (quest, goblin) {
  const unsub = quest.goblin.getX('restartUnsub');
  if (unsub) {
    unsub();
  }
  const killUnsub = quest.goblin.getX('killUnsub');
  if (killUnsub) {
    killUnsub();
  }
  const server = getServer(goblin);
  if (server) {
    server.kill();
  }
});

Goblin.registerQuest(goblinName, 'dist', function* (
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

Goblin.registerQuest(goblinName, '_save.stats', function (quest, stats) {
  quest.do();
  quest.log.info(stats);
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
