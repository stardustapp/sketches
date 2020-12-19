import { AutomatonBuilder, Automaton, ApiHandle } from "https://uber.danopia.net/deno/dust@v1beta1/client-automaton/mod.ts";
import { StringEntry, FolderEntry } from "https://uber.danopia.net/deno/dust@v1beta1/skylink/src/mod.ts";

import { ApiFactory } from 'https://deno.land/x/aws_api@v0.2.0/client/mod.ts';
import SQS from 'https://deno.land/x/aws_api@v0.2.0/services/sqs@2012-11-05/mod.ts';

if (!Deno.env.get('AWS_REGION')) throw new Error(
  `Missing AWS configuration!`);

class IrcNetwork {
  constructor(handles: {state: ApiHandle, persist: ApiHandle}) {
    this.sendFunc = handles.state.subPath`/wire/send/invoke`;
    this.persist = handles.persist;

    this.chanTypesPromise = this.getSupported('CHANTYPES', '#');
  }
  sendFunc: ApiHandle;
  persist: ApiHandle;
  chanTypesPromise: Promise<string | null>;

  async getSupported(key: string, defaultVal: string | null = null) {
    const str = await this.persist.subPath`/supported/${key}`.readString();
    return str || defaultVal;
  }
  async isChannel(target: string) {
    const channelTypes = await this.chanTypesPromise;
    return channelTypes?.includes(target.slice(0, 1)) ?? false;
  }
  isChannelJoined(channel: string) {
    return this.persist.subPath`/channels/${channel}/is-joined`.readBoolean() ?? false;
  }
  sendPacket(pkt: {
    command: string;
    params?: string[];
    tags?: Record<string,string>;
  }) {
    return this.sendFunc.invokeWithChildren([
      new StringEntry('command', pkt.command.toUpperCase()),
      new FolderEntry('params', (pkt.params ?? []).map((param, idx) =>
        new StringEntry(`${idx+1}`, param))),
      new FolderEntry('tags', Object.keys(pkt.tags ?? {}).map(tagKey =>
        new StringEntry(tagKey, pkt.tags![tagKey]))),
    ]);
  }

  async sendNoticeToTarget(target: string, message: string) {
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
  constructor(automaton: Automaton<IrcOutboundRuntime>) {
    this.ircState = automaton.getHandle(`/irc-state`);
    this.ircPersist = automaton.getHandle(`/irc-persist`);
    this.networks = new Map;

    const awsFactory = new ApiFactory();
    this.sqs = new SQS(awsFactory);
  }
  ircState: ApiHandle;
  ircPersist: ApiHandle;
  networks: Map<string, IrcNetwork>;
  sqs: SQS;

  getNetwork(networkName: string) {
    let network = this.networks.get(networkName);
    if (!network) {
      network = new IrcNetwork({
        state: this.ircState.subPath`/networks/${networkName}`,
        persist: this.ircPersist.subPath`/networks/${networkName}`,
      });
      this.networks.set(networkName, network);
    }
    return network;
  }

  async doSomeWork(QueueUrl: string) {
    const {Messages} = await this.sqs.receiveMessage({
      QueueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
    });
    if (!Messages) return;

    for (const msg of Messages) {
      console.log("Processing message", msg.MessageId, msg.Body);
      const body = JSON.parse(msg.Body!);
      if (body.ver != 1) throw new Error(
        `Message version wasn't 1: ${body.ver}`);
      if (body.protocol != 'irc') throw new Error(
        `Message protocol wasn't irc: ${body.protocol}`);

      await this.getNetwork(body.network)
        .sendNoticeToTarget(body.target, body.message);

      await this.sqs.deleteMessage({
        QueueUrl,
        ReceiptHandle: msg.ReceiptHandle!,
      });

      if (body.network !== 'wg69') {
        await new Promise(ok => setTimeout(ok, 1000));
      }
    }
  }

  async runNow(): Promise<never> {
    const QueueName = Deno.env.get('SQS_QUEUE_NAME');
    if (!QueueName) throw new Error(
      `Missing AWS SQS queue name!`);
    const {QueueUrl} = await this.sqs.getQueueUrl({QueueName});

    console.log(`Starting main SQS loop for`, QueueUrl);
    while (true) {
      try {
        await this.doSomeWork(QueueUrl!);
      } catch (err) {
        console.error(err.stack);
        await this.getNetwork('wg69').sendNoticeToTarget('#skyhook',
          QueueName+' CRASH: '+
          err.stack.slice(0, 400).replace(/\n/g, '␤')); // NL char
        await new Promise(ok => setTimeout(ok, 10 * 1000));
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
  }
}

new AutomatonBuilder<IrcOutboundRuntime>()
  .withMount('/irc-state', 'session:/services/irc-automaton/namespace/state')
  .withMount('/irc-persist', 'session:/persist/irc')
  .withRuntimeConstructor(IrcOutboundRuntime)
  //.withServicePublication('irc-automaton')
  .launch();
