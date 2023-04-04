'use strict';

/* Here we ensure to detach explicitly the debugger because it
 * slows down too much the prod-server.
 * NOTE: comment this code if you want to debug this file.
 */
const inspector = require('inspector');
inspector.close();

if (process.platform === 'win32') {
  /* HACK: workaround when require.resolve is used on modules
   * that are created as junctions on Windows. When a junction
   * is resolved to the real directory, the drive letter doesn't
   * use the same case. It's a major problem when a module is
   * required from module in node_modules/ and other modules
   * in lib/ (referenced in node_modules/ with a junction).
   */
  const Module = require('module');
  const origResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function () {
    const result = origResolveFilename.apply(this, arguments);
    return result.replace(/^([a-z]):/, (c) => c.toUpperCase());
  };
}

/* Prevent webpack to search stuff in asar files via graceful.js */
process.noAsar = true;

const webpack = require('webpack');
const path = require('path');
const fs = require('fs');
const xFs = require('xcraft-core-fs');
const watt = require('gigawatts');
const {webpackConfig, setWebpackConfig} = require('./webpack-config.js');

process.chdir(path.join(__dirname, '..'));

const handleMessage = watt(function* (payload, next) {
  const {
    goblin,
    mainGoblinModule,
    jobId,
    releasePath,
    outputPath,
    debugPath,
    options,
    withIndexHTML,
  } = payload;

  webpackConfig.build(mainGoblinModule, options);

  const cfg = setWebpackConfig(
    goblin,
    releasePath,
    outputPath,
    debugPath,
    options.target,
    mainGoblinModule
  );
  const config = cfg.toJS();

  xFs.mkdir(config.output.path);

  if (withIndexHTML) {
    fs.writeFileSync(
      path.join(outputPath, 'index.html'),
      fs.readFileSync(path.join(__dirname, 'index.html'))
    );
  }

  /* Remove source-map when building a release (public) */
  if (!options.sourceMap) {
    config.devtool = false;
  }

  if (options.indexFile) {
    // Patch index.js entry
    if (path.basename(options.indexFile) === options.indexFile) {
      config.entry = config.entry.map((e) =>
        e.endsWith('index.js') ? e.replace('index.js', options.indexFile) : e
      );
    } else {
      config.entry = options.indexFile;
    }
  }

  if (options.target) {
    config.target = options.target;
  }

  if (options.outputFilename) {
    config.output.filename = options.outputFilename;
  }

  if (options.alias) {
    if (!config.resolve) {
      config.resolve = {};
    }
    if (!config.resolve.alias) {
      config.resolve.alias = {};
    }
    Object.assign(config.resolve.alias, options.alias);
  }

  let packExist;
  try {
    console.log(`///WEBPACK CONTEXT: ${config.context}`);
    const compiler = webpack(config);

    //  https://webpack.js.org/api/plugins/compiler/#event-hooks
    compiler.hooks.invalid.tap({name: 'goblin webpack'}, () =>
      console.warn('compiler in invalid state')
    );

    compiler.hooks.compile.tap({name: 'goblin webpack'}, () =>
      console.log('\x1b[5m\x1b[33m', '🚧 COMPILING 🚧', '\x1b[0m')
    );

    compiler.hooks.done.tap({name: 'goblin webpack'}, function () {
      console.log('\x1b[32m', `🍻 DONE!`);
      process.send({
        type: 'job-done',
        result: {jobId},
      });
    });

    try {
      const clearModule = require('clear-module');
      clearModule('../babel.config.js');

      process.env.GOBLIN_WEBPACK_RELEASEPATH = releasePath;
      const stats = yield compiler.run(next);

      stats.compilation.errors.forEach((err) => {
        console.error(err.stack);
      });

      if (stats.compilation.errors.length) {
        throw new Error(`the web packing has failed`);
      }
    } finally {
      delete process.env.GOBLIN_WEBPACK_RELEASEPATH;
    }

    packExist = fs.existsSync(
      path.join(config.output.path, config.output.filename)
    );

    if (packExist) {
      if (debugPath) {
        /* Copy the bundle.js file next to the stats.json file */
        xFs.fse.copySync(
          path.join(outputPath, config.output.filename),
          path.join(debugPath, config.output.filename)
        );
      }
      process.send({
        type: 'job-done',
        result: {jobId},
      });
    }
  } catch (e) {
    const error = {
      name: e.name,
      message: e.message,
      stack: e.stack,
      fileName: e.fileName,
      lineNumber: e.lineNumber,
      columnNumber: e.columnNumber,
    };
    process.send({
      type: 'error',
      result: {error},
    });
  }

  process.exit(0);
});

process.once('message', (msg) => {
  handleMessage(msg);
});
