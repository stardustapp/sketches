const Future = require('fibers/future');
const moment = require('moment');
const path = require('path');
const createThrottle = require('async-throttle')

const mkdirp = Future.wrap(require('mkdirp'));
const writeFile = Future.wrap(require('fs').writeFile);
const accessFile = Future.wrap(require('fs').access);

const {LogLine} = require('./log-line.js');

//////////////////////////////
// CONFIGURATION PHASE

const argv = require('minimist')(process.argv.slice(2), {
  string: ['date'],
});
const {network, channel, query, background, date, all, output} = argv;
if (!network) {
  console.warn('--network= is required');
  process.exit(2);
}
if (!channel && !query && !background) {
  console.warn('One of --channel= or --query= or --background=yes is required')
  process.exit(2);
}
if (!date && !all) {
  console.warn('One of --date=YYYY-MM-DD or --all=[yes/missing] is required');
  process.exit(2);
}

const networkPath = `/persist/irc/networks/${network}`;
let inputPath = networkPath;
if (channel) {
  inputPath += `/channels/${channel}/log`;
} else if (query) {
  inputPath += `/queries/${query}/log`;
} else if (background) {
  inputPath += `/server-log`;
}

const {StartEnvClient, StartClient} = require('../nodejs-domain-client');
Future.task(() => {

  const exportsPath = path.join(output || 'output', network, channel || query || 'server');
  mkdirp(exportsPath).wait();

  // let days age a bit before we grab them
  const safeCutoff = moment.utc().subtract(4, 'hour').startOf('day');

  //////////////////////////////
  // ENUMERATION PHASE

  console.log('Connecting to profile servers...');
  profile = StartEnvClient('irc').wait();

  let startDate, endDate;
  if (date) {
    startDate = moment.utc(date, 'YYYY-MM-DD');
    const dateGrain = ['year', 'month', 'day'][date.split('-').length-1];
    endDate = startDate.clone().add(1, dateGrain).subtract(1, 'day');
  } else if (all) {
    console.log(inputPath+'/horizon');
    startDate = moment.utc(profile.callApi('loadString', inputPath+'/horizon').wait(), 'YYYY-MM-DD');
    endDate = moment.utc(profile.callApi('loadString', inputPath+'/latest').wait(), 'YYYY-MM-DD');
    if (!startDate.isValid() || !endDate.isValid()) {
      console.warn(`I didn't see log-partitioning markers. Can't process --all`);
      process.exit(3);
    }
  }

  let day = startDate.clone();
  while (day <= endDate) {
    const dayStr = day.format('YYYY-MM-DD');
    day.add(1, 'day');
    const dayPath = inputPath + '/' + dayStr;
    const dayFsPath = path.join(exportsPath, dayStr+'.txt');

    if (all === 'missing') {
      if (day > safeCutoff)
        continue; // the day is too new, ignore for now

      try {
        accessFile(dayFsPath).wait();
        continue; // we already downloaded the day
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;
      }
    }

    process.stdout.write(dayStr + '\t');

    horizon = profile.callApi('loadString', dayPath+'/horizon').wait();
    latest = profile.callApi('loadString', dayPath+'/latest').wait();
    if (!horizon) {
      process.stdout.write(`no log found, ignoring\n`);
      continue;
    }

    //////////////////////////////
    // EXTRACTION PHASE

    const promises = [];
    const lineThrottle = createThrottle(50);
    for (let i = parseInt(horizon); i <= parseInt(latest); i++) {
      const treePath = dayPath+'/'+i.toString();
      const structFuture = profile.loadDataStructure(treePath, 2);
      const promise = lineThrottle(() => structFuture.promise().then(struct => {
        const entry = new LogLine(struct);
        const line = entry.stringify();
        if (line)
          return `[${entry.timestamp}] ${line}`;
        return null;
      }, err => {
        console.log(i, err);
        process.stdout.write('          '+'\t');
      }));
      promises.push(promise);
    }

    //////////////////////////////
    // OUTPUT PHASE

    const lines = Future.fromPromise(Promise.all(promises)).wait().filter(x => x);
    writeFile(dayFsPath, lines.join('\n')+'\n', 'utf-8').wait();
    process.stdout.write(`wrote ${lines.length} lines\n`);
  }

  process.exit(0);
}).detach();
