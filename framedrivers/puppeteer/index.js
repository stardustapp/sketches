const {FrameDriver, listOf} = require('../_core');
const puppeteer = require('puppeteer-core');
const fetch = require('node-fetch');

const fd = new FrameDriver({
  name: 'Puppeteer',
  heritage: 'df80c47b-088f-4557-a1d1-04522f6debc2',
  description: 'Script against arbitrary Web pages via headless Chromium tabs',
  tags: [
    'webapp automation',
    'web browser',
    'world wide web',
  ],
  upstreamLibrary: 'https://github.com/GoogleChrome/puppeteer',
});
fd.define(function() {

  //const browser = await puppeteer.connect({
  //  browserWSEndpoint: 'ws://127.0.0.1:9227/...',
  //});
  //const pages = await browser.pages();
  //const content = await pages[0].content();
  //console.log(content);

  // 'new pageApi(input)' returns a Handle to this interface (with currying)
  // Function impl's get the 'input' value as 'this'
  const pageApi = this.interfaceFrame('Browser Page', {
    'Click': {
      input: {
        selector: String,
        button: 'left',
        clickCount: 1,
        delay: 0,
      },
      impl(input) {
        return this.click(input.selector, input);
      }
    },

    'Close': {
      input: {
        runBeforeUnload: false,
      },
      impl(input) {
        return this.close(input.runBeforeUnload);
      }
    },

    'Get content': {
      output: String,
      impl() {
        return this.content();
      }
    },

    'Evaluate': {
      input: {
        pageFunction: String,
      },
      output: Object,
      impl(input) {
        return this.evaluate(input.pageFunction);
      }
    },

    'Focus': {
      input: {
        selector: String,
      },
      impl(input) {
        return this.focus(input.selector);
      }
    },

    'Go to': {
      input: {
        url: String,
        timeout: 30 * 1000,
        waitUntil: listOf(String), // load, domcontentloaded, networkidle0, networkidle2
      },
      // TOOD: output: Response,
      impl(input) {
        return this.goto(input.url, input);
      }
    },

    'Take Screenshot': {
      input: {
        type: 'png', // jpeg, png
        quality: 95, // TODO: guessed
        fullPage: false,
        /*clip: { // TODO: optional structures with required fields
          x: Number,
          y: Number,
          width: Number,
          height: Number,
        },*/
        omitBackground: false,
      },
      output: Buffer,
      impl(input) {
        return this.screenshot(input);
      }
    },

    'Set Viewport': {
      input: {
        width: Number,
        height: Number,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscope: false,
      },
      impl(input) {
        return this.setViewport(input);
      }
    },

    'Get Title': {
      output: String,
      impl() {
        return this.title();
      }
    },

    'Type': {
      input: {
        selector: String,
        text: String,
        delay: 0,
      },
      impl(input) {
        return this.type(input.selector, input);
      }
    },

    'Get URL': {
      output: String,
      impl() {
        return this.url();
      }
    },

    'Wait for Function': {
      input: {
        function: String,
        pollFrames: false,
        pollMutations: false,
        pollInterval: -1,
        timeout: 30 * 1000,
      },
      impl(input) {
        const options = {
          timeout: input.timeout,
        }
        if (input.pollFrames)
          options.polling = 'raf';
        else if (input.pollMutations)
          options.polling = 'mutation';
        else if (input.pollInterval !== -1)
          options.polling = input.pollInterval;

        return this.waitForFunction(input.function, options);
      }
    },

    'Wait for Navigation': {
      input: {
        waitUntil: {
          load: true,
          domcontentloaded: false,
          networkidle0: false,
          networkidle2: false,
        },
        timeout: 30 * 1000,
      },
      impl(input) {
        return this.waitForNavigation({
          timeout: input.timeout,
          waitUntil: Object
            .keys(input.waitUntil)
            .filter(k => input.waitUntil[k]),
        });
      }
    },

    'Wait for Selector': {
      input: {
        selector: String,
        visible: false,
        hidden: false,
        timeout: 30 * 1000,
      },
      impl(input) {
        return this.waitFor(input.selector, input);
      }
    },

    'Wait for Timeout': {
      input: {
        timeout: Number,
      },
      impl(input) {
        return this.waitFor(input.timeout);
      }
    },

  });

  const browserApi = this.interfaceFrame('Browser', {
    'List Pages': {
      output: listOf(pageApi),
      async impl() {
        const pages = await this.pages();
        return pages.map(p => new PageApi(p));
      }
    },
  });

  const browserVersion = this.dataFrame('Browser Version', {
    fields: {
      'Browser': String,
      'Protocol Version': String,
      'User Agent': String,
      'V8 Version': String,
      'WebKit Version': String,
    },
    legacyKeyMapper(words) {
      return words.join('-');
    },
  });

  const connectFunc = this.functionFrame('Connect', {
    input: {
      host: 'localhost:9222',
      secure: false,
    },
    output: {
      version: browserVersion,
      browser: browserApi,
    },
    async impl({host}) {
      // Discover Versions and WS endpoint
      const resp = await fetch(`http://${host}/json/version`);
      const version = await resp.json();
      const {webSocketDebuggerUrl} = version;
      delete version.webSocketDebuggerUrl;

      // Connect Puppeteer to the websocket
      const path = webSocketDebuggerUrl.split('/').slice(3).join('/');
      const wsUrl = `ws://${host}/${path}`;
      console.log('--> Discovered Chrome browser backdoor at', wsUrl);
      const browser = await puppeteer.connect({
        browserWSEndpoint: wsUrl,
      });

      // Return version data and browser interface
      return {
        version: new browserVersion(version),
        browser: new browserApi(browser),
      };
    }
  });
  this.export(connectFunc);

}).launch();
