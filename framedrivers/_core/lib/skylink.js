const http = require('http');
const fetch = require('node-fetch');

const httpAgent = new http.Agent({
	keepAlive: true,
});

exports.SkylinkClient = class SkylinkClient {
  constructor(uri) {
    this.endpointUri = uri;
  }

  async volley(request) {
    const resp = await fetch(this.endpointUri, {
      method: 'POST',
      body: JSON.stringify(request),
      agent: httpAgent,
    });

    if (resp.status === 200) {
      return resp.json();
    } else { // TODO: check if there's json to parse
      console.log(await resp.text().catch(ex => ex.message));
      throw new Error(`Skylink endpoint responded with HTTP status ${resp.status}`);
    }
  }
}
