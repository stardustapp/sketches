const Future = require('fibers/future');
const moment = require('moment');
const path = require('path');

const {ExtractDays} = require('./extract-days.js');

// quiet the skylink/netop failures
// get spammed when scanning sparse logs
process.argv.push('-q');

//////////////////////////////
// CONFIGURATION PHASE

const argv = require('minimist')(process.argv.slice(2), {
  string: ['date'],
});
const {network, channel, query, background, date, auto, output, formats, curate} = argv;
const allContexts = !channel && !query && !background;
const logFormats = (formats || 'json,text').split(',');

if (!date && !auto) {
  console.warn('One of --date=YYYY-MM-DD or --auto=[all/missing] is required');
  console.warn('To limit what is downloaded, you can add --network=...');
  console.warn(`Select within a network using --channel= or --query= or --background=server`);
  process.exit(2);
}

// let days age a bit before we grab them
const safeCutoff = moment.utc().subtract(4, 'hour').startOf('day');

// curation feature, provide --curate=dryrun or --curate=delete
const curateCutoff = moment.utc().subtract(1, 'month').startOf('day');
if (curate && date) throw new Error(
  `Data curation cannot be combined with specific-date extraction.`);
if (curateCutoff >= safeCutoff) throw new Error(
  `BUG: Data curation cutoff isn't before the safety cutoff. Sheepishly doing nothing.`);

const {StartEnvClient, StartClient} = require('../nodejs-domain-client');
Future.task(() => {

  console.log('Connecting to profile servers...');
  profile = StartEnvClient('irc').wait();
  function listFolders (path) {
    return profile.listChildrenNames(path, y => y.Type === 'Folder');
  }

  //////////////////////////////
  // NETWORK SELECTION

  const networks = network
    ? [network]
    : listFolders(`/persist/irc/networks`).wait();

  for (const network of networks) {
    const networkPath = `/persist/irc/networks/${network}`;

    //////////////////////////////
    // CONTEXT SELECTION

    const contexts = {};
    switch (false) {

      case !channel:
        contexts[channel] = `${networkPath}/channels/${channel}/log`;
        break;

      case !query:
        contexts[query] = `${networkPath}/queries/${query}/log`;
        break;

      case background !== 'server':
        contexts['server log'] = `${networkPath}/server-log`;
        break;

      default:
        for (const channel of listFolders(`${networkPath}/channels`).wait()) {
          contexts[channel] = `${networkPath}/channels/${channel}/log`;
        }
        for (const query of listFolders(`${networkPath}/queries`).wait()) {
          contexts[query] = `${networkPath}/queries/${query}/log`;
        }
        contexts['server log'] = `${networkPath}/server-log`;
    }

    for (const context of Object.keys(contexts)) {
      console.log(contexts[context]);

      //////////////////////////////
      // PARTITION SELECTION

      let startDate, endDate;
      if (date) {
        startDate = moment.utc(date, 'YYYY-MM-DD');
        const dateGrain = ['year', 'month', 'day'][date.split('-').length-1];
        endDate = startDate.clone().add(1, dateGrain).subtract(1, 'day');
      } else if (auto) {
        startDate = moment.utc(profile.callApi('loadString', contexts[context]+'/horizon').wait(), 'YYYY-MM-DD');
        endDate = moment.utc(profile.callApi('loadString', contexts[context]+'/latest').wait(), 'YYYY-MM-DD');

        if (!startDate.isValid() || !endDate.isValid()) {
          throw new Error(`I didn't see log-partitioning markers. Can't process --all`);
        }

        // Protect from downloading incomplete days
        while (endDate >= safeCutoff) {
          endDate.subtract(1, 'day');
        }
        if (endDate < startDate) {
          throw new Error(`I found a negative number of days to collect. Huh?`);
        }
      } else throw new Error(
        `BUG: no partition selector selected`);

      //////////////////////////////
      // EXTRACTION PHASE

      const presentDays = ExtractDays(profile, {
        inputPath: contexts[context],
        exportsPath: path.join(output || 'output', network, context),
        startDate, endDate,
        onlyIfMissing: auto === 'missing',
        isServerLog: context === 'server log',
        formats: logFormats,
      });

      //////////////////////////////
      // CURATION PHASE

      if (curate && startDate < curateCutoff && presentDays.length > 1) {
        const oldDays = presentDays.slice(0, -1)
          .filter(x => x.dayM < curateCutoff && !x.fresh)
          .map(x => x.dayStr);
        const newStartDay = presentDays
          .find(x => x.dayM >= curateCutoff)
          || presentDays.slice(-1)[0];

        switch (curate) {
          case 'dryrun':
            console.log('Curation DRYRUN: Would unlink', oldDays.join(' '), 'and set /horizon to', newStartDay.dayStr);
            break;

          case 'delete':
            for (const dayStr of oldDays) {
              profile.callApi('unlink', contexts[context]+'/'+dayStr).wait();
            }
            profile.callApi('putString', contexts[context]+'/horizon', newStartDay.dayStr).wait();
            console.log('Curation: Deleted', oldDays.length, 'partition(s) of', context, 'starting from', oldDays[0], 'and set horizon to', newStartDay.dayStr);
            break;
        }
      }

      console.log();
    } // context loop
  } // network loop

  process.exit(0);
}).detach();
