const http = require('http');
const express = require('express');
const webpack = require('webpack');
const MemoryFS = require('memory-fs');
const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp').sync;
const watt = require('gigawatts');
const {webpackConfig, setWebpackConfig} = require('./webpack-config.js');

const handleMessage = watt(function*(payload, next) {
  const mFs = new MemoryFS();
  const {goblin, jobId, options, projectPath} = payload;
  let {port} = payload;

  const outputPath = path.join(projectPath, '/devpack');
  mkdirp(outputPath);

  webpackConfig.build(options.target);
  const cfg = setWebpackConfig(goblin, null, null, null, options.target);
  const config = cfg.toJS();

  try {
    if (options.target) {
      config.target = options.target;
    }

    if (options.indexFile) {
      // Patch index.js entry
      config.entry = config.entry.map(e =>
        e.endsWith('index.js') ? e.replace('index.js', options.indexFile) : e
      );
    }

    config.entry.splice(
      0,
      0,
      `webpack-hot-middleware/client?path=//localhost:${port}/__webpack_hmr&reload=true`
    );

    //write index in memory and in devpack/
    mFs.writeFileSync(
      '/index.html',
      fs.readFileSync(path.join(__dirname, 'index.html'))
    );

    fs.writeFileSync(
      path.join(outputPath, '/index.html'),
      fs.readFileSync(path.join(__dirname, 'index.html'))
    );

    console.log(`///WEBPACK CONTEXT: ${config.context}`);
    const compiler = webpack(config);

    //always serv a memfs to compiler
    compiler.outputFileSystem = mFs;

    //  https://webpack.js.org/api/plugins/compiler/#event-hooks
    compiler.hooks.invalid.tap({name: 'goblin webpack'}, () =>
      console.warn('compiler in invalid state')
    );

    compiler.hooks.compile.tap({name: 'goblin webpack'}, () =>
      console.log('\x1b[5m\x1b[33m', '🚧 COMPILING 🚧')
    );

    compiler.hooks.done.tap({name: 'goblin webpack'}, () => {
      console.log('\x1b[5m\x1b[32m', `🍻 DONE!`);
      //copy fresh bundle.js to devpack/
      try {
        mFs.readdirSync('/').forEach(file => {
          console.log(file);
          const content = mFs.readFileSync(`/${file}`);
          fs.writeFileSync(path.join(outputPath, file), content);
        });
      } catch (err) {
        console.dir(err);
      } finally {
        process.send({type: 'job-done', result: {jobId}});
      }
    });

    const app = express();

    app.use((req, res, next) => {
      let content;
      switch (req.url) {
        case '/': {
          content = mFs.readFileSync('/index.html');
          res.set('Content-Type', 'text/html; charset=utf-8');
          res.set('Content-Length', content.length);
          res.send(content);
          res.end();
          //next();
          break;
        }

        case `/${config.output.filename}`: {
          content = mFs.readFileSync(`/${config.output.filename}`);
          res.set('Access-Control-Allow-Origin', '*'); // To support XHR, etc.
          res.set('Content-Type', 'application/javascript');
          res.set('Content-Length', content.length);
          res.send(content);
          res.end();
          break;
        }
        case '/__webpack_hmr': {
          next();
          break;
        }
        default:
          try {
            content = mFs.readFileSync(req.url);
            res.send(content);
            res.end();
          } catch (err) {
            console.warn(`webpack-dev-server: file not found, ${req.url}`);
            next();
          }

          break;
      }
    });

    app.use(
      require('webpack-dev-middleware')(compiler, {
        noInfo: true,
        publicPath: config.output.publicPath,
      })
    );
    app.use(require('webpack-hot-middleware')(compiler));

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

  if (fs.existsSync(path.join(outputPath, `/${config.output.filename}`))) {
    //We can serv the devpack
    fs.readdirSync(outputPath).forEach(file => {
      console.log(file);
      const content = fs.readFileSync(path.join(outputPath, file));
      mFs.writeFileSync(`/${file}`, content);
    });
    process.send({type: 'job-done', result: {jobId}});
  }
});

process.once('message', msg => {
  handleMessage(msg);
});
