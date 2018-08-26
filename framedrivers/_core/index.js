const {upsertFileContents} = require('./lib/utils');
const {SkylinkClient} = require('./lib/skylink');
const apiTypes = require('./lib/api-types');

// TODO: establish local identity (UUID)
const IdentityFile = process.env.SD_IDENTIFY_FILE || 'driver-identity.txt';
function getPersonalUuid() {
  return upsertFileContents(IdentityFile, () => {
    console.log('--> generating new identity file');
    return require('uuid/v4')();
  });
}

skylinkUri = process.env.SKYLINK_URI;
if (!skylinkUri) {
  console.log('!-> no stardust server found!');
  console.log('    please try again with SKYLINK_URI in the environment');
  process.exit(4);
}
console.log('    using skylink server:', skylinkUri);
const skylink = new SkylinkClient(skylinkUri);

const timeout = function(ms) {
  return new Promise(res => setTimeout(res, ms));
}

exports.tupleOf = function(...items) {
  const tuple = new apiTypes.Tuple(null);
  tuple.items = items;
  return tuple;
}
exports.listOf = function(item) {
  // TODO
  const list = new apiTypes.Type('Folder');
  list.item = item;
  return list;
}

class ApiFrameBuilder {
  constructor() {
    this.items = new Map;
  }
  setupFunc(opts) {
    this.items.set('', opts);
  }
  getter(name, opts) {
    this.items.set(name, opts);
  }
  function(name, opts) {
    this.items.set(name, opts);
  }
  build() {
    return this;
  }
}

class FrameFactory {
  constructor() {
    this.frames = new Map;
  }
  dataFrame(name, opts) {
    this.frames.set(name, opts);
  }
  apiFrame(name, setup) {
    const builder = new ApiFrameBuilder;
    setup.call(builder);
    this.frames.set(name, builder.build());
  }
  build() {
    return this;
  }
}

function printError(prefix, {message, stack}) {
  console.log(prefix, message);
  console.log(stack.slice(stack.indexOf('\n')+1));
}

exports.FrameDriver = class FrameDriver {
  constructor(meta) {
    this.metadata = meta; // name, description, tags, upstreamLibrary

    this.factory = new FrameFactory;
    this.skylinkUri = skylinkUri;
    this.identityToken = getPersonalUuid();
    console.log('    using identity key', this.identityToken);
  }

  define(cb) {
    try {
      cb.call(this.factory);
      console.log('--> ran framedriver setup callback');

      this.compile();
      console.log('==> successfully compiled framedriver structure');
      return this;

    } catch (err) {
      printError('!-> COMPILE FAULT:', err);
      process.exit(1);
    }
  }

  compile() {
    console.log(this);
  }

  async launch() {
    try {
      console.log('--> starting server communications...');
      const pong = await skylink.volley({Op: 'ping'});
      if (!pong.Ok) throw new Error(`ping wasn't okay.`);
      console.log('    profile server is reachable');

      // TODO: register our 'driver' identity against the public API
      console.log('--> launched driver session');

      while (true) {
        console.log('    looping...');
        await timeout(60000);
      }
    } catch (err) {
      printError('!-> RUNTIME FAULT:', err);
      process.exit(2);
    }
  }
}
