const Future = require('fibers/future');
const moment = require('moment');
const path = require('path');

const createThrottle = require('async-throttle')
const lineThrottle = createThrottle(50);

const mkdirp = Future.wrap(require('mkdirp'));
const writeFile = Future.wrap(require('fs').writeFile);
const accessFile = Future.wrap(require('fs').access);
const gzip = Future.wrap(require('zlib').gzip);

const {LogLine} = require('./log-line.js');

exports.ExtractDays = function (profile, {
  inputPath, exportsPath,
  startDate, endDate,
  onlyIfMissing,
  isServerLog,
  formats=['json', 'text'],
}) {

  mkdirp(exportsPath).wait();

  //////////////////////////////
  // ENUMERATION PHASE

  let day = startDate.clone();
  while (day <= endDate) {
    const dayStr = day.format('YYYY-MM-DD');
    day.add(1, 'day');
    const dayPath = inputPath + '/' + dayStr;
    const dayFsPathTxt = path.join(exportsPath, dayStr+'.txt');
    const dayFsPathJson = path.join(exportsPath, dayStr+'.jsonl.gz');

    if (onlyIfMissing) {
      try {
        formats.includes('text') && accessFile(dayFsPathTxt).wait();
        try {
          formats.includes('json') && accessFile(dayFsPathJson).wait();
          continue; // we already downloaded the day
        } catch (err) {
          if (err.code !== 'ENOENT')
            throw err;
        }
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
    const structPromises = [];
    for (let i = parseInt(horizon); i <= parseInt(latest); i++) {
      const treePath = dayPath+'/'+i.toString();
      const structFuture = profile.loadDataStructure(treePath, 2).promise();
      structPromises.push(structFuture.catch(err => ({index: i, missing: true})));
      const promise = lineThrottle(() => structFuture.then(struct => {
        const entry = new LogLine(i, struct);
        const line = entry.stringify({isServerLog});
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

    if (formats.includes('json')) {
      const structs = Future.fromPromise(Promise.all(structPromises)).wait();
      const structText = Buffer.from(structs.map(x => JSON.stringify(x)).join('\n'), 'utf-8');
      const structGzip = gzip(structText).wait();
      writeFile(dayFsPathJson, structGzip).wait();
    }

    if (formats.includes('text')) {
      const lines = Future.fromPromise(Promise.all(promises)).wait().filter(x => x);
      writeFile(dayFsPathTxt, lines.join('\n')+'\n', 'utf-8').wait();
      process.stdout.write(`wrote ${lines.length} lines\n`);
    }
  }

  console.log();
}
