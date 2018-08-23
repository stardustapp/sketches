const {FrameDriver, tupleOf, listOf} = require('../_core');
const hue = require('node-hue-api');

const fd = new FrameDriver({
  name: 'Phillips Hue API',
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
})
fd.launch(function() {

  const lightState = this.dataFrame('light state', {
    data: {
      on: Boolean,
      bri: Number,
      hue: Number,
      sat: Number,
      effect: String,
      xy: tupleOf(Number, Number),
      alert: String,
      colormode: String,
      reachable: Boolean,
    },
  });

  const lightInfo = this.dataFrame('light info', {
    data: {
      id: String,
      name: String,
      type: String,
      modelid: String,
      manufacturername: String,
      uniqueid: String,
      swversion: String,
      state: lightState,
    },
  });

  const bridgeConfig = this.dataFrame('bridge', {
    props: {
      ipaddress: String,
      username: String,
    },
    data: {
      timeout: 20000,
      port: 80,
    },
  });
  const bridgeApi = this.apiFrame('bridge api', function() {
    this.setupFunc({
      input: bridgeConfig,
      impl(input) {
        this.hue = new hue.HueApi(
          input.ipaddress, input.username,
          input.timeout, input.port);
      }
    });

    this.getter('configuration', {
      type: Object,
      impl() { return this.hue.config(); }
    });

    this.getter('advertisement', {
      type: Object,
      impl() { return this.hue.description(); }
    });

    this.getter('all lights', {
      type: listOf(lightInfo),
      impl() { return this.hue.lights(); }
    });
  });

  const setupApi = this.apiFrame('setup api', function() {
    this.function('register', {
      input: {
        ipaddress: String,
        devicetype: 'stardust framedriver',
      },
      output: bridgeConfig,
      async impl({ipaddress, devicetype}) {
        const api = new hue.HueApi();
        const username = await api.registerUser(ipaddress, devicetype);
        console.log('!!! registered user as', username, 'at', ipaddress);
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

  this.export(() => setupApi.createHandle());
});
