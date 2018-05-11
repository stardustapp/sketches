const Future = require('fibers/future');
const moment = require('moment');
const path = require('path');
const mkdirp = Future.wrap(require('mkdirp'));
const writeFile = Future.wrap(require('fs').writeFile);

//////////////////////////////
// CONFIGURATION PHASE

const argv = require('minimist')(process.argv.slice(2), {
  string: ['date'],
});
const {network, channel, query, background, date, output} = argv;
if (!network || !date) {
  console.warn('--network= and --date=YYYY-MM-DD are required');
  process.exit(2);
}
if (!channel && !query && !background) {
  console.warn('One of --channel= or --query= or --background=yes is required')
  process.exit(2);
}

const networkPath = `/persist/irc/networks/${network}`;
let inputPath = networkPath;
if (channel) {
  inputPath += `/channels/${channel}/log`;
} else if (query) {
  inputPath += `/queries/${query}/log`;
} else {
  inputPath += `/server-log`;
}

const {StartEnvClient, StartClient} = require('../nodejs-domain-client');
Future.task(() => {

  const exportsPath = path.join(output || 'output', network, channel || query || 'server');
  mkdirp(exportsPath).wait();

  //////////////////////////////
  // ENUMERATION PHASE

  console.log('Connecting to profile servers...');
  profile = StartEnvClient('irc').wait();

  const startDate = moment.utc(date, 'YYYY-MM-DD');
  const dateGrain = ['year', 'month', 'day'][date.split('-').length-1];
  const endDate = startDate.clone().add(1, dateGrain).subtract(1, 'day');

  let day = startDate.clone();
  while (day <= endDate) {
    const dayStr = day.format('YYYY-MM-DD');
    day.add(1, 'day');
    const dayPath = inputPath + '/' + dayStr;
    process.stdout.write(dayStr + '\t');

    horizon = profile.callApi('loadString', dayPath+'/horizon').wait();
    latest = profile.callApi('loadString', dayPath+'/latest').wait();
    if (!horizon) {
      process.stdout.write(`no log found, ignoring\n`);
      continue;
    }

    //////////////////////////////
    // EXTRACTION PHASE

    const lines = [];
    for (let i = parseInt(horizon); i <= parseInt(latest); i++) {
      const entry = profile.loadDataStructure(dayPath+'/'+i.toString(), 2).wait();
      entry.params = Object.keys(entry.params).map(key => entry.params[key]);
      entry.timestamp = moment.utc(entry.timestamp).format('YYYY-MM-DD HH:mm:ss');

      if (entry.command === 'PRIVMSG' && entry.params[1].startsWith('\x01ACTION ')) {
        entry.command = 'CTCP';
        entry.params[1] = entry.params[1].slice(1, -1);
      }

      let line;
      switch (entry.command) {

        case 'PRIVMSG':
          line = `<${entry.prefixName}> ${entry.params[1]}`;
          break;

        case 'JOIN':
        case 'PART':
        case 'QUIT':
          const symbol = {JOIN: '→', PART: '←', QUIT: '⇐'}[entry.command];
          const verb = {JOIN: 'joined '+entry.params[0], PART: 'left', QUIT: 'quit'}[entry.command];
          const msgIdx = (entry.command == 'QUIT') ? 0 : 1;
          const suffix = entry.params[msgIdx] ? `: ${entry.params[msgIdx]}` : '';
          line = `${symbol} ${entry.prefixName} ${verb} (${entry.prefixUser}@${entry.prefixHost})${suffix}`;
          break;

        case 'NICK':
          line = `* ${entry.prefixName} → ${entry.params[0]}`;
          break;

        case '332':
          line = `* Topic is: ${entry.params[2]}`;
          break;
        case '333':
          const topicTime = moment(parseInt(entry.params[3])*1000)
              .format('YYYY-MM-DD HH:mm:ss');
          line = `* Set by ${entry.params[2]} at ${topicTime}`;
          break;

        case '353':
        case '366':
          break; // NAMES

        case 'CTCP':
          if (entry.params[1].startsWith('ACTION ')) {
            line = `— ${entry.prefixName} ${entry.params[1].slice('ACTION '.length)}`;
            break;
          } else if (entry.params[1] === 'ACTION') {
            line = `— ${entry.prefixName} ${entry.params[2]}`;
            break;
          }
          // fall through to default
        default:
          console.log(dayStr, i, entry);
          line = [entry.command, ...entry.params].join(' ');
      }

      if (line) {
        line = `[${entry.timestamp}] ${line}`;
        //console.log(line);
        lines.push(line);
      }
    }

    //////////////////////////////
    // OUTPUT PHASE

    writeFile(path.join(exportsPath, dayStr+'.txt'),
        lines.join('\n'), 'utf-8').wait();
    process.stdout.write(`wrote ${lines.length} lines\n`);
  }

  process.exit(0);
}).detach();
