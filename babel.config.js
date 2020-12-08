'use strict';

const path = require('path');
const xFs = require('xcraft-core-fs');

const roots = xFs
  .lsdir(path.join(__dirname, '..'), /^(xcraft|goblin)-/)
  .map((root) => `../${root}/*`);

module.exports = {
  babelrcRoots: roots,
};
