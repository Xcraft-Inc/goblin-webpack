'use strict';

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: require ('./lib/service.js'),
    rc: {
      pack: {
        parallel: true,
        desc: 'pack a webapp',
        options: {
          params: {
            required: 'location',
          },
        },
      },
      'server.start': {
        parallel: true,
        desc: 'start a webpack server',
        options: {
          params: {
            required: 'goblin',
          },
        },
      },
      'server.stop': {
        parallel: true,
        desc: 'stop a webpack server',
        options: {
          params: {
            required: 'goblin',
          },
        },
      },
      '_save.stats': {
        parallel: true,
        desc: null,
        options: {
          params: {
            required: 'goblin',
            optional: 'stats',
          },
        },
      },
      _request: {
        parallel: true,
        desc: null,
        options: {
          params: {
            required: 'route',
            optional: 'resp',
          },
        },
      },
    },
  };
};
