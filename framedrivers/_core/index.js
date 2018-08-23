// Blank line aesthetic
process.on('exit', () => console.log());

// TODO: establish local identity (UUID)
const fs = require('fs');

skylinkUri = process.env.SKYLINK_URI;
if (!skylinkUri) {
  console.log('!-> no stardust server found!');
  console.log('    please try again with SKYLINK_URI in the environment');
  console.log();
  process.exit(4);
}
console.log('--> using skylink server:', skylinkUri);

const http = require('http');
const httpAgent = new http.Agent({
	keepAlive: true,
});

const fetch = require('node-fetch');
async function volley(request) {
  const resp = await fetch(skylinkUri, {
    method: 'POST',
    agent: httpAgent,
  });
  if (resp.status === 200) {
    return resp.json();
  } else { // TODO: check if there's json to parse
    console.log(await resp.text());
    throw new Error(`Skylink endpoint responded with HTTP status ${resp.status}`);
  }
}

const timeout = ms => new Promise(res => setTimeout(res, ms))

exports.tupleOf = function(...items) {
  console.log('    tuple of', items);
}
exports.listOf = function(items) {
  console.log('    list of', items);
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
  export(getter) {
    console.log('export', getter);
  }
}

exports.FrameDriver = class FrameDriver {
  constructor(meta) {
    this.metadata = meta; // name, description, tags, upstreamLibrary
    this.factory = new FrameFactory;
  }
  async launch(cb) {
    function printError(prefix, {message, stack}) {
      console.log(prefix, message);
      console.log(stack.slice(stack.indexOf('\n')+1));
    }

    try {
      await cb.call(this.factory);
    } catch (err) {
      printError('!-> COMPILE FAULT:', err);
      process.exit(1);
    }

    try {
      const pong = await volley({Op: 'ping'});
      if (!pong.Ok) throw new Error(`ping wasn't okay.`);
      console.log('    server is reachable');

      while (true) {
        console.log('--> looping...');
        await timeout(5000);
      }
    } catch (err) {
      printError('!-> RUNTIME FAULT:', err);
      process.exit(2);
    }
  }
}
