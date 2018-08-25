const {FrameDriver} = require('../_core');
const puppeteer = require('puppeteer-core');

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

  

}).launch();
