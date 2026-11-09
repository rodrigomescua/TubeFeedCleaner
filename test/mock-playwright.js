const Module = require('node:module');
const load = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === 'playwright' && process.env.PLAYWRIGHT_MOCK) {
    return load.call(this, process.env.PLAYWRIGHT_MOCK, parent, isMain);
  }
  return load.call(this, request, parent, isMain);
};
