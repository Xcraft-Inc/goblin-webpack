const WebpackDevServer = require('webpack-dev-server');
const webpack = require('webpack');
const MemoryFS = require('memory-fs');
const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp').sync;
const watt = require('gigawatts');
const {webpackConfig, setWebpackConfig} = require('./webpack-config.js');
const {ufs} = require('unionfs');
const {link} = require('linkfs');

const handleMessage = watt(function*(payload, next) {
  const {goblin, jobId, options, projectPath} = payload;
  let {port} = payload;
  try {
    webpackConfig.build(options.target);

    const cfg = setWebpackConfig(goblin, null, null, null, options.target);

    const config = cfg.toJS();

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

    const outputPath = path.join(projectPath, '/devpack');
    mkdirp(outputPath);
    const mFs = new MemoryFS();
    //make a link between memfs root and /devpack/ folder
    const lFs = link(fs, ['/', outputPath]);

    //Union memfs<->lFs
    ufs.use(mFs).use(lFs);

    //write index in memory and in devpack/
    ufs.writeFileSync(
      '/index.html',
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
      console.log('compiling')
    );

    compiler.hooks.done.tap({name: 'goblin webpack'}, () => {
      console.log(`compiler ${jobId}.done`);
      //copy fresh bundle.js to devpack/
      const content = mFs.readFileSync(`/${config.output.filename}`);
      lFs.writeFileSync(`/${config.output.filename}`, content);
      process.send({type: 'job-done', result: {jobId}});
    });

    const server = new WebpackDevServer(compiler, {
      stats: {
        colors: true,
      },
      before: app => {
        app.use((req, res, next) => {
          let content;
          switch (req.url) {
            case '/':
              content = lFs.readFileSync('/index.html');
              res.set('Content-Type', 'text/html; charset=utf-8');
              res.set('Content-Length', content.length);
              res.send(content);
              break;
            case `/${config.output.filename}`:
              content = lFs.readFileSync(`/${config.output.filename}`);
              res.set('Access-Control-Allow-Origin', '*'); // To support XHR, etc.
              res.set('Content-Type', 'application/javascript');
              res.set('Content-Length', content.length);
              res.send(content);
              break;
            default:
              next();
          }
        });

        if (process.env.NODE_ENV !== 'production') {
          app.use(require('webpack-hot-middleware')(compiler));
        }

        app.get('/app/*', req =>
          process.send({type: 'open', result: {route: req.url}})
        );
      },
    });

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

  if (fs.existsSync(path.join(projectPath, 'devpack', 'main.bundle.js'))) {
    //We can serv this outdated bundle
    process.send({type: 'job-done', result: {jobId}});
  }
});

process.once('message', msg => {
  handleMessage(msg);
});
