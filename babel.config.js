'use strict';

const path = require('path');
const xFs = require('xcraft-core-fs');

let nodeModulesRoot = path.join(__dirname, '..');

let roots = xFs
  .lsdir(nodeModulesRoot, /^(xcraft-(core|contrib)|goblin)-/)
  .map((root) => `${path.relative(__dirname, nodeModulesRoot)}/${root}/*`);

if (process.env.GOBLIN_WEBPACK_RELEASEPATH) {
  nodeModulesRoot = path.join(
    process.env.GOBLIN_WEBPACK_RELEASEPATH,
    'node_modules'
  );

  roots = roots.concat(
    xFs
      .lsdir(nodeModulesRoot, /^(xcraft-(core|contrib)|goblin)-/)
      .map((root) => `${path.relative(__dirname, nodeModulesRoot)}/${root}/*`)
  );
}

module.exports = {
  babelrcRoots: roots,
};
