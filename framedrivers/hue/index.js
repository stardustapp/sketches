const {FrameDriver, tupleOf, listOf} = require('../_core');
const hue = require('node-hue-api');

const fd = new FrameDriver({
  name: 'Phillips Hue API',
  heritage: '8062ef1f-fd1e-4fe4-8048-57a823c3c67f',
  description: 'Wraps the Hue Lighting APIs to enable controlling a Hue bridge on the local network.',
  tags: [
    'hue bridge',
    'api client',
    'proprietary api',
    'phillips hue',
    'internet of things',
    'connected lighting',
  ],
  upstreamLibrary: 'https://github.com/peter-murray/node-hue-api',
});
fd.define(function() {

  const lightState = this.dataFrame('light state', {
    fields: {
      'On': Boolean,
      'Brightness': Number,
      'Hue': Number,
      'Saturation': Number,
      'Effect': String,
      'XY': tupleOf(Number, Number),
      'Alert': String,
      'Color Mode': String,
      'Reachable': Boolean,
    },
    legacyKeyMapper(words) {
      switch (words) {
        case 'Brightness': return 'bri';
        case 'Saturation': return 'sat';
        default: return words
          .map(w => w.toLowerCase())
          .join('');
      }
    },
  });

  const lightInfo = this.dataFrame('light info', {
    fields: {
      'id': String,
      'name': String,
      'type': String,
      'modelid': String,
      'manufacturername': String,
      'uniqueid': String,
      'swversion': String,
      'state': lightState,
    },
  });

  const bridgeApi = this.interfaceFrame('hue', function() {

    this.function('get configuration', {
      output: Object,
      impl() { return this.hue.config(); }
    });

    this.function('get advertisement', {
      output: Object,
      impl() { return this.hue.description(); }
    });

    this.function(['lights', 'list'], {
      output: listOf(lightInfo),
      impl() { return this.hue.lights(); }
    });
  });

  const bridgeUser = this.dataFrame('bridge user', {
    fields: {
      'ipaddress': String,
      'port': 80,
      'username': String,
    },
    methods: {
      'connect': {
        input: {
          timeout: 20 * 1000,
        },
        output: bridgeApi,
        impl(input) {
          const hue = new hue.HueApi(
            this.ipaddress, this.username,
            this.timeout, input.port,
            );
          return bridgeApi.createHandle(hue);
        }
      },
    },
  });

  const setupApi = this.interfaceFrame('setup', function() {
    this.function('register', {
      input: {
        ipaddress: String,
        devicetype: 'stardust framedriver',
      },
      output: bridgeApi,
      async impl({ipaddress, devicetype}) {
        const api = new hue.HueApi();
        const username = await api.registerUser(ipaddress, devicetype);
        console.log('--> registered hue user', username, 'at', ipaddress);
        return bridgeApi.createHandle({
          ipaddress: ipaddress,
          username: username,
        });
      }
    });

    this.function('nupnp search', {
      output: listOf({
        id: String,
        name: String,
        ipaddress: String,
        mac: String,
      }),
      async impl() {
        return hue.nupnpSearch();
      }
    });

    this.function('upnp search', {
      input: {
        timeout: 2000,
      },
      output: listOf({
        id: String,
        ipaddress: String,
      }),
      async impl({timeout}) {
        return hue.upnpSearch(timeout);
      }
    });
  });

}).launch();
