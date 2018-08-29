const {upsertFileContents} = require('./lib/utils');
const {SkylinkClient} = require('./lib/skylink');

const apiTypes = require('./lib/api-types');
const apiLiterals = require('./lib/api-literals');
exports.ApiTypes = apiTypes;

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
  const tuple = new apiTypes.Tuple('');
  tuple.items = items;
  return tuple;
}
exports.listOf = function(item) {
  // TODO
  const list = new apiTypes.Type('', 'Folder');
  list.item = item;
  return list;
}

const {FrameBuilder} = require('./lib/frame-factory.js');
const {Framework} = require('./lib/framework.js');

function printError(prefix, {message, stack}) {
  console.log(prefix, message);
  console.log(stack.slice(stack.indexOf('\n')+1));
}

exports.FrameDriver = class FrameDriver {
  constructor(meta) {
    this.metadata = meta; // name, description, tags, upstreamLibrary

    this.skylinkUri = skylinkUri;
    this.identityToken = getPersonalUuid();
    console.log('    using identity key', this.identityToken);
  }

  define(cb) {
    try {
      const builder = new FrameBuilder(this.metadata);
      cb.call(builder);
      console.log('--> ran framedriver setup callback');

      this.framework = new Framework(builder);
      console.log('==> successfully built driver framework');
      return this;

    } catch (err) {
      printError('!-> COMPILE FAULT:', err);
      process.exit(1);
    }
  }

  async launch() {
    try {
      console.log('--> starting server communications...');
      const pong = await skylink.volley({Op: 'ping'});
      if (!pong.Ok) throw new Error(`ping wasn't okay.`);
      console.log('    profile server is reachable');

      console.log('sending framework', JSON.stringify(this.framework.describe(), null, 2));
      const helloEntry = new apiLiterals.Folder('', [
        new apiLiterals.String('identity token', this.identityToken),
        new apiLiterals.String('framework', JSON.stringify(this.framework.describe())),
      ]);
      const introduction = await skylink.volley({
        Op: 'invoke',
        Path: '/domain/introduce-driver/invoke',
        Input: helloEntry,
      });
      if (!introduction.Ok) {
        if (introduction.Output) console.log(introduction.Output.StringValue);
        throw new Error(`failed to perform introduction with server.`);
      }
      console.log('--> launched driver session', introduction);

      // this.framework.newExport();

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
