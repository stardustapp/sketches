global.WebSocket = require('ws');
global.fetch = require('node-fetch');
require('source-map-support').install();

const Future = require('fibers/future');
const {Launchpad, Orbiter} = require('@dustjs/client');

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
        listChildrenNames,
        loadDataStructure,
        listChildNames,
        // skylink: orbiter.mountTable.api,
      }
      future.return(client);
    }, err => {
      console.log(`Couldn't open chart. Server said:`, err);
      future.throw(err);
    });
  return future;
}

function callApi (name, ...args) {
  const promise = this.orbiter.mountTable.api[name](...args);
  return Future.fromPromise(promise);
}

function listChildrenNames (path, predicate=()=>true) {
  const api = this.callApi('enumerate', path, {
    maxDepth: 1,
  }).promise();

  return Future.fromPromise(api.then(x => {
    return x
      .filter(y => y.Name)
      .filter(predicate)
      .map(y => y.Name);
  }));
}

function loadDataStructure (path, depth) {
  const api = this.callApi('enumerate', path, {
    maxDepth: depth,
  }).promise();

  function cleanName(name) {
    return decodeURIComponent(name).replace(/[ -][a-z]/g, (x => x[1].toUpperCase()));
  }

  return Future.fromPromise(api.then(x => {
    const struct = {};
    const folders = {};
    x.filter(y => y.Name).forEach(ent => {
      var value;
      switch (ent.Type) {
        case 'String':
          value = ent.StringValue;
          break;
        case 'Folder':
          value = {};
          folders[ent.Name] = value;
          break;
        case 'Blob':
          // const load = () => this.callApi('loadFile', path+'/'+ent.Name);
          const load = () => ({wait() {
            const buff = Buffer.from(ent.Data, 'base64');
            buff.mime = ent.Mime;
            return buff;
          }});
          value = {load};
          break;
        default:
          console.log('dunno', ent);
      }

      if (ent.Name.includes('/')) {
        // subdir
        const names = ent.Name.split('/');
        const parent = folders[names.slice(0, -1).join('/')];
        parent[cleanName(names.slice(-1)[0])] = value;
      } else {
        // in root
        struct[cleanName(ent.Name)] = value;
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
