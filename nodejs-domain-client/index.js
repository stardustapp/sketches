root.window = root;
root.WebSocket = require('ws');
root.fetch = require('node-fetch');

// this is so bad.
require('./app-suite/js-core/constants.js');

root.Launchpad = exports.Launchpad = require('./app-suite/js-core/orbiter/launchpad.js');
root.Orbiter = exports.Orbiter = require('./app-suite/js-core/orbiter/orbiter.js');
root.MountTable = exports.MountTable = require('./app-suite/js-core/orbiter/mount-table.js');
root.SkylinkMount = exports.SkylinkMount = require('./app-suite/js-core/orbiter/mounts/skylink.js');

root.Skylink = exports.Skylink = require('./app-suite/js-core/skylink/client.js');
root.SkylinkWsTransport = exports.SkylinkWsTransport = require('./app-suite/js-core/skylink/transports/ws.js');

const Future = require('fibers/future');

exports.StartEnvClient = function (context) {
  const domain = process.env.STARDUST_DOMAIN || 'devmode.cloud';
  const profile = process.env.STARDUST_PROFILE;
  const secret = process.env.STARDUST_SECRET;
  if (!profile) {
    console.log('Please export STARDUST_PROFILE (and probs STARDUST_SECRET, maybs STARDUST_DOMAIN) and run this again');
    process.exit(2);
  }
  return exports.StartClient(domain, profile, secret, context);
}

exports.StartClient = function (domain, profile, secret, context) {
  const orbiter = new Orbiter();
  const launcher = new Launchpad(domain, profile, secret);
  launcher.providedSecret = secret;

  const future = new Future;
  var promise = orbiter.autoLaunch(launcher)
    .then(() => {
      const client = {
        orbiter,
        callApi,
        loadDataStructure,
        listChildNames,
        // skylink: orbiter.mountTable.api,
      }
      future.return(client);
    }, err => {
      alert(`Couldn't open chart. Server said: ${err}`);
      future.throw(err);
    });
  return future;
}

function callApi (name, ...args) {
  const promise = this.orbiter.mountTable.api[name](...args);
  return Future.fromPromise(promise);
}

function loadDataStructure (path, depth) {
  const api = this.callApi('enumerate', path, {
    maxDepth: depth,
  }).promise();

  function cleanName(name) {
    return name.replace(/ [a-z]/g, (x => x[1].toUpperCase()));
  }

  return Future.fromPromise(api.then(x => {
    const struct = {};
    const folders = {};
    x.filter(y => y.Name).forEach(ent => {
      switch (ent.Type) {
        case 'String':
          if (ent.Name.includes('/')) {
            // subdir
            const names = ent.Name.split('/');
            const parent = folders[names.slice(0, -1).join('/')];
            parent[cleanName(names.slice(-1)[0])] = ent.StringValue;
          } else {
            // in root
            struct[cleanName(ent.Name)] = ent.StringValue;
          }
          break;
        case 'Folder':
          const folder = {};
          folders[ent.Name] = folder;
          if (ent.Name.includes('/')) {
            // subdir
            const names = ent.Name.split('/');
            const parent = folders[names.slice(0, -1).join('/')];
            parent[cleanName(names.slice(-1)[0])] = folder;
          } else {
            // in root
            struct[cleanName(ent.Name)] = folder;
          }
          break;
        default:
          console.log('dunno', ent);
      }
    });
    return struct;
  }));
};

function listChildNames (path) {
  const api = this.callApi('enumerate', path, {
    maxDepth: 1,
  }).promise();

  return Future.fromPromise(api.then(x => {
    return x.filter(ent => ent.Name).map(ent => ent.Name);
  }));
};
