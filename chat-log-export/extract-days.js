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
const {network, channel, query, background, date, all, output} = argv;
if (!network ) {
  console.warn('--network= is required');
  process.exit(2);
}
if (!channel && !query && !background) {
  console.warn('One of --channel= or --query= or --background=yes is required')
  process.exit(2);
}
if (!date && !all) {
  console.warn('One of --date=YYYY-MM-DD or --all=yes is required');
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
      let entry;
      try {
        entry = profile.loadDataStructure(dayPath+'/'+i.toString(), 2).wait();
      } catch (err) {
        console.log(i, err);
        process.stdout.write('          '+'\t');
        continue;
      }
      if (!entry.params) entry.params = [];
      entry.params = Object.keys(entry.params).map(key => entry.params[key]);
      entry.timestamp = moment.utc(entry.timestamp).format('YYYY-MM-DD HH:mm:ss');

      if (entry.command === 'PRIVMSG' && entry.params[1] && entry.params[1].startsWith('\x01ACTION ')) {
        entry.command = 'CTCP';
        entry.params[1] = entry.params[1].slice(1, -1);
      }

      let line;
      switch (entry.command) {

        // messages
        case 'PRIVMSG':
          line = `<${entry.prefixName}> ${entry.params[1]}`;
          break;
        case 'NOTICE':
          line = `[${entry.prefixName || entry.sender}] ${entry.params[1] || entry.text}`;
          break;

        case 'MODE':
          line = `* ${entry.prefixName} set ${entry.params.slice(1).join(' ')}`;
          break;
        case 'INVITE':
          line = `* ${entry.prefixName} invited ${entry.params[0]} to ${entry.params[1]}`;
          break;

        // channel membership changes
        case 'JOIN':
        case 'PART':
        case 'QUIT':
          const symbol = {JOIN: '→', PART: '←', QUIT: '⇐'}[entry.command];
          const verb = {JOIN: 'joined '+entry.params[0], PART: 'left', QUIT: 'quit'}[entry.command];
          const msgIdx = (entry.command == 'QUIT') ? 0 : 1;
          const suffix = entry.params[msgIdx] ? `: ${entry.params[msgIdx]}` : '';
          line = `${symbol} ${entry.prefixName} ${verb} (${entry.prefixUser}@${entry.prefixHost})${suffix}`;
          break;
        case 'KICK':
          line = `* ${entry.params[1]} was kicked by ${entry.prefixName} (${entry.params[2]})`;
          break;
        case 'NICK':
          line = `* ${entry.prefixName} → ${entry.params[0]}`;
          break;

        case 'TOPIC':
          line = `* ${entry.prefixName} set the topic to: ${entry.params[1]}`;
          break;
        case '332':
          line = `* Topic is: ${entry.params[2]}`;
          break;
        case '328':
          line = `* Channel website: ${entry.params[2]}`;
          break;
        case '333':
          const topicTime = moment(parseInt(entry.params[3])*1000)
              .format('YYYY-MM-DD HH:mm:ss');
          line = `* Set by ${entry.params[2]} at ${topicTime}`;
          break;

        case '353': // NAMES
        case '366': // end NAMES
        case '315': // end WHO
          break;

        // server-window logs
        case 'LOG':
          line = `* ${entry.text}`;
          break;
        case 'BLOCK':
          const parts = [entry.params.join(' ')];
          if (entry.text)
            parts.push(entry.text.replace(/\n/g, '\n\t'));
          line = `* ${parts.join('\n\t')}`;
          break;
        case 'ERROR':
          line = `! ERROR: ${entry.params.join(' ')}`;
          break;

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
          if (entry.command.match(/^\d\d\d$/)) {
            const sliceIdx = background ? 1 : 2;
            line = ['*', entry.command, ...entry.params.slice(sliceIdx)].join(' ');
            break;
          }

          console.log(i, entry);
          process.stdout.write('          '+'\t');
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
