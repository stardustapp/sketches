import { AutomatonBuilder } from '@dustjs/client-automaton'
import AWS from 'aws-sdk'
import { promisify } from 'util'

const sleep = promisify(setTimeout);

class IrcNetwork {
  constructor({state, persist}) {
    this.sendFunc = state.subPath`/wire/send/invoke`;
    this.persist = persist;

    this.chanTypesPromise = this.getSupported('CHANTYPES', '#');
  }
  async getSupported(key, defaultVal=null) {
    const str = await this.persist.subPath`/supported/${key}`.readString();
    return str || defaultVal;
  }
  async isChannel(target) {
    const channelTypes = await this.chanTypesPromise;
    return channelTypes.includes(target.slice(0, 1));
  }
  isChannelJoined(channel) {
    return this.persist.subPath`/channels/${channel}/is-joined`.readBoolean();
  }
  sendPacket({command, params=[], tags={}}) {
    return this.sendFunc.invokeWithChildren([
      { Name: 'command', Type: 'String', StringValue: command.toUpperCase() },
      { Name: 'params', Type: 'Folder', Children: params.map((param, idx) => (
        { Name: `${idx+1}`, Type: 'String', StringValue: param }
      )) },
      { Name: 'tags', Type: 'Folder', Children: Object.keys(tags).map(tagKey => (
        { Name: tagKey, Type: 'String', StringValue: tags[tagKey] }
      )) },
    ]);
  }

  async sendNoticeToTarget(target, message) {
    if (await this.isChannel(target)) {
      const isJoined = await this.isChannelJoined(target);
      if (!isJoined) {
        // TODO: check if message can be sent without joining?
        await this.sendPacket({command: 'JOIN', params: [target]});
        // TODO: check if the join worked?
      }
    }

    await this.sendPacket({command: 'NOTICE', params: [target, message]});
  }
}

class IrcOutboundRuntime {
  constructor(automaton) {
    this.ircState = automaton.getHandle(`/irc-state`);
    this.ircPersist = automaton.getHandle(`/irc-persist`);
    this.networks = new Map;
    this.sqs = new AWS.SQS;
  }
  getNetwork(networkName) {
    if (!this.networks.has(networkName)) {
      this.networks.set(networkName, new IrcNetwork({
        state: this.ircState.subPath`/networks/${networkName}`,
        persist: this.ircPersist.subPath`/networks/${networkName}`,
      }));
    }
    return this.networks.get(networkName);
  }

  async doSomeWork(QueueUrl) {
    const {Messages} = await this.sqs.receiveMessage({
      QueueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
    }).promise();
    if (!Messages) return;

    for (const msg of Messages) {
      console.log("Processing message", msg.MessageId, msg.Body);
      const body = JSON.parse(msg.Body);
      if (body.ver != 1) throw new Error(
        `Message version wasn't 1: ${body.ver}`);
      if (body.protocol != 'irc') throw new Error(
        `Message protocol wasn't irc: ${body.protocol}`);

      await this.getNetwork(body.network)
        .sendNoticeToTarget(body.target, body.message);

      await this.sqs.deleteMessage({
        QueueUrl,
        ReceiptHandle: msg.ReceiptHandle,
      }).promise();

      if (body.network !== 'wg69') {
        await sleep(1000);
      }
    }
  }

  async runNow() {
    const {QueueUrl} = await this.sqs.getQueueUrl({QueueName: process.env.SQS_QUEUE_NAME}).promise();
    console.log(QueueUrl)

    console.log(`Starting main SQS loop for`, QueueUrl);
    while (true) {
      try {
        await this.doSomeWork(QueueUrl);
      } catch (err) {
        console.error(err.stack);
        await this.getNetwork('wg69').sendNoticeToTarget('#skyhook',
          process.env.SQS_QUEUE_NAME+' CRASH: '+
          err.stack.slice(0, 400).replace(/\n/g, '␤')); // NL char
        await sleep(10000);
      }
    }

    // {"ver":1,"protocol":"irc","network":"freenode","target":"#stardust-test","message":"Hello, World"}
    // const wire = await this.automaton.getHandle('/irc-state/networks/freenode/wire').enumerateChildren({Depth:1});
    // console.log(wire)
    // const freenode = this.getNetwork('freenode');
    // console.log(await freenode.isChannel('#dagd'));
    // console.log(await freenode.isChannel('danopia'));
    // console.log(await freenode.isChannelJoined('#dagd'));
    // console.log(await freenode.isChannelJoined('#stardust-test'));
    // await freenode.sendPacket({command: `NOTICE`, params: ['#stardust-test', 'Hello, World!']})
    // await this.getNetwork('wg69').sendNoticeToTarget('#wg69', 'Hi!');
    throw new Error(`TODO`);
  }
}

new AutomatonBuilder()
.withMount('/irc-state', 'session:/services/irc-automaton/namespace/state')
.withMount('/irc-persist', 'session:/persist/irc')
.withRuntimeConstructor(IrcOutboundRuntime)
  //.withServicePublication('irc-automaton')
  .launch();
