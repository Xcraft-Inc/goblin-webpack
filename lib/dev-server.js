require('v8-compile-cache');
const http = require('http');
const express = require('express');
const webpack = require('webpack');
const path = require('path');
const fs = require('fs');
const xFs = require('xcraft-core-fs');
const watt = require('gigawatts');
const {webpackConfig, setWebpackConfig} = require('./webpack-config.js');

process.chdir(path.join(__dirname, '..'));

const copy = watt(function* (srcFs, src, dstFs, dst, next) {
  const stats = yield srcFs.stat(src, next);
  if (stats.isDirectory()) {
    const dstExists = yield dstFs.exists(dst, next.arg(0));
    if (!dstExists) {
      yield dstFs.mkdir(dst, next);
    }
    const files = yield srcFs.readdir(src, next);
    for (const file of files) {
      const newSrc = path.join(src, file);
      const newDst = path.join(dst, file);
      yield copy(srcFs, newSrc, dstFs, newDst);
    }
  } else if (stats.isFile()) {
    const content = yield srcFs.readFile(src, next);
    yield dstFs.writeFile(dst, content, next);
  } else {
    throw new Error('Unsupported file type');
  }
});

const copySync = function (srcFs, src, dstFs, dst) {
  const stats = srcFs.statSync(src);
  if (stats.isDirectory()) {
    const dstExists = dstFs.existsSync(dst);
    if (!dstExists) {
      dstFs.mkdirSync(dst, {recursive: true});
    }
    const files = srcFs.readdirSync(src);
    for (const file of files) {
      const newSrc = path.join(src, file);
      const newDst = path.join(dst, file);
      copySync(srcFs, newSrc, dstFs, newDst);
    }
  } else if (stats.isFile()) {
    const content = srcFs.readFileSync(src);
    dstFs.writeFileSync(dst, content);
  } else {
    throw new Error('Unsupported file type');
  }
};

const handleMessage = watt(function* (payload, next) {
  const {goblin, mainGoblinModule, jobId, options} = payload;
  let {port} = payload;

  webpackConfig.build(mainGoblinModule, options.target);
  const cfg = setWebpackConfig(
    goblin,
    null,
    null,
    null,
    options.target,
    mainGoblinModule
  );
  const config = cfg.toJS();

  xFs.mkdir(config.output.path);

  let packExist;
  try {
    if (options.target) {
      config.target = options.target;
    }

    if (options.indexFile) {
      // Patch index.js entry
      config.entry = config.entry.map((e) =>
        e.endsWith('index.js') ? e.replace('index.js', options.indexFile) : e
      );
    }

    config.entry.splice(
      0,
      0,
      `webpack-hot-middleware/client?path=//localhost:${port}/__webpack_hmr&reload=true`
    );

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
      process.send({type: 'job-done', result: {jobId}});
    });

    packExist = fs.existsSync(
      path.join(config.output.path, config.output.filename)
    );
    let initialized = false;

    const app = express();

    app.use((req, res, next) => {
      let content;
      const toParse = `http://localhost:${port}${req.url}`;
      console.log(toParse);

      if (!initialized) {
        compiler.outputFileSystem.mkdirSync(config.output.path, {
          recursive: true,
        });
        compiler.outputFileSystem.writeFileSync(
          path.join(config.output.path, 'index.html'),
          fs.readFileSync(path.join(__dirname, 'index.html'))
        );
        if (packExist) {
          xFs
            .ls(config.output.path, /.*\.hot-update\..*/)
            .forEach((file) => xFs.rm(path.join(config.output.path, file)));
          copySync(
            fs,
            config.output.path,
            compiler.outputFileSystem,
            config.output.path
          );
        }
        initialized = true;
      }

      const url = new URL(toParse);
      switch (url.pathname) {
        case '/': {
          content = compiler.outputFileSystem.readFileSync(
            path.join(config.output.path, 'index.html')
          );
          res.set('Content-Type', 'text/html; charset=utf-8');
          res.set('Content-Length', content.length);
          res.send(content);
          res.end();
          break;
        }

        case `/${config.output.filename}`: {
          content = compiler.outputFileSystem.readFileSync(
            path.join(config.output.path, config.output.filename)
          );
          res.set('Access-Control-Allow-Origin', '*'); // To support XHR, etc.
          res.set('Content-Type', 'application/javascript');
          res.set('Content-Length', content.length);
          res.send(content);
          res.end();
          break;
        }

        case '/__webpack_hmr': {
          res.set('Access-Control-Allow-Origin', '*');
          next();
          break;
        }

        default: {
          const file = path.join(config.output.path, req.url);
          try {
            try {
              content = compiler.outputFileSystem.readFileSync(
                path.join(config.output.path, req.url)
              );
            } catch (ex) {
              if (ex.code !== 'ENOENT') {
                throw ex;
              }
              content = fs.readFileSync(file);
            }
          } catch (ex) {
            console.warn(`webpack-dev-server: file not found, ${file}`);
            console.warn(ex.stack || ex.message || ex);
          }
          res.set('Access-Control-Allow-Origin', '*');
          switch (path.extname(req.url)) {
            case '.png':
              res.set('Content-Type', 'image/png');
              break;
            case '.svg':
              res.set('Content-Type', 'image/svg+xml');
              break;
            case '.woff':
              res.set('Content-Type', 'font/woff');
              break;
            case '.woff2':
              res.set('Content-Type', 'font/woff2');
              break;
          }
          res.send(content);
          res.end();
          break;
        }
      }
    });

    if (process.env.GOBLIN_WEBPACK_NO_DEV_SERVER !== 'true' || !packExist) {
      app.use(
        require('webpack-dev-middleware')(compiler, {
          publicPath: config.output.publicPath,
          writeToDisk: true,
        })
      );
      app.use(require('webpack-hot-middleware')(compiler));
    } else {
      console.warn('webpack-disabled');
    }

    const server = http.createServer(app);
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

    if (packExist) {
      process.send({type: 'job-done', result: {jobId}});
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
    process.send({type: 'error', result: {error}});
  }
});

process.once('message', (msg) => {
  handleMessage(msg);
});
