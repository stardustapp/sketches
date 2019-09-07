const moment = require('moment');

exports.LogLine = class LogLine {
  constructor(struct) {
    for (const key in struct) {
      this[key] = struct[key];
    }

    if (!this.params) this.params = [];
    this.params = Object.keys(this.params).map(key => this.params[key]);
    this.timestamp = moment.utc(this.timestamp).format('YYYY-MM-DD HH:mm:ss');

    if (this.command === 'PRIVMSG' && this.params[1] && this.params[1].startsWith('\x01ACTION ')) {
      this.command = 'CTCP';
      this.params[1] = this.params[1].slice(1, -1);
    }
  }

  stringify() {
    switch (this.command) {

      // messages
      case 'PRIVMSG':
        return `<${this.prefixName}> ${this.params[1]}`;
      case 'NOTICE':
        return `[${this.prefixName || this.sender}] ${this.params[1] || this.text}`;

      case 'MODE':
        return `* ${this.prefixName} set ${this.params.slice(1).join(' ')}`;
      case 'INVITE':
        return `* ${this.prefixName} invited ${this.params[0]} to ${this.params[1]}`;

      // channel membership changes
      case 'JOIN':
      case 'PART':
      case 'QUIT':
        const symbol = {JOIN: '→', PART: '←', QUIT: '⇐'}[this.command];
        const verb = {JOIN: 'joined '+this.params[0], PART: 'left', QUIT: 'quit'}[this.command];
        const msgIdx = (this.command == 'QUIT') ? 0 : 1;
        const suffix = this.params[msgIdx] ? `: ${this.params[msgIdx]}` : '';
        return `${symbol} ${this.prefixName} ${verb} (${this.prefixUser}@${this.prefixHost})${suffix}`;
      case 'KICK':
        return `* ${this.params[1]} was kicked by ${this.prefixName} (${this.params[2]})`;
      case 'NICK':
        return `* ${this.prefixName} → ${this.params[0]}`;

      case 'TOPIC':
        return `* ${this.prefixName} set the topic to: ${this.params[1]}`;
      case '332':
        return `* Topic is: ${this.params[2]}`;
      case '328':
        return `* Channel website: ${this.params[2]}`;
      case '333':
        const topicTime = moment(parseInt(this.params[3])*1000)
            .format('YYYY-MM-DD HH:mm:ss');
        return `* Set by ${this.params[2]} at ${topicTime}`;

      case '353': // NAMES
      case '366': // end NAMES
      case '315': // end WHO
        return null;

      // server-window logs
      case 'LOG':
        return `* ${this.text}`;
      case 'BLOCK':
        const parts = [this.params.join(' ')];
        if (this.text)
          parts.push(this.text.replace(/\n/g, '\n\t'));
        return `* ${parts.join('\n\t')}`;
      case 'ERROR':
        return `! ERROR: ${this.params.join(' ')}`;

      case 'CTCP':
        if (this.params[1].startsWith('ACTION ')) {
          return `— ${this.prefixName} ${this.params[1].slice('ACTION '.length)}`;
        } else if (this.params[1] === 'ACTION') {
          return `— ${this.prefixName} ${this.params[2]}`;
        }
        // fall through to default
      default:
        if (this.command.match(/^\d\d\d$/)) {
          const sliceIdx = background ? 1 : 2;
          return ['*', this.command, ...this.params.slice(sliceIdx)].join(' ');
        }

        console.log(i, entry);
        process.stdout.write('          '+'\t');
        return [this.command, ...this.params].join(' ');
    }
  }
}
