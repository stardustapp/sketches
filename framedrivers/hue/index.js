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
      on: Boolean,
      brightness: Number,
      hue: Number,
      saturation: Number,
      effect: String,
      xy: tupleOf(Number, Number),
      alert: String,
      colormode: String,
      reachable: Boolean,
    },
    ingestKey: {
      brightness: 'bri',
      saturation: 'sat',
    }
  });

  const lightInfo = this.dataFrame('light info', {
    fields: {
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

  const bridgeApi = this.apiFrame('hue', function() {
    this.setupFunc({
      input: {
        ipaddress: String,
        username: String,
      },
      impl(input) {
        this.hue = new hue.HueApi(
          input.ipaddress, input.username,
          //input.timeout, input.port,
          );
      }
    });

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

  const setupApi = this.apiFrame('setup', function() {
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
