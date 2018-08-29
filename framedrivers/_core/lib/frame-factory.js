const apiTypes = require('./api-types');

exports.Frame =
class Frame {
  constructor(name) {
    this.name = name;
    this.__frame = true;
  }
}

exports.DataFrame =
class DataFrame extends exports.Frame {
  constructor(name, config) {
    super(name);
    this.type = 'Data';

    const legacyKeyMapper = config.legacyKeyMapper || ((words) => words.join(''));
    this.fields = Object
      .keys(config.fields)
      .sort()
      .map(fieldName => ({
        name: fieldName,
        legacyName: legacyKeyMapper(fieldName.split(' ')),
        inner: apiTypes.Type.from(config.fields[fieldName]),
      }));
  }
}

exports.InterfaceFrame =
class InterfaceFrame extends exports.Frame {
  constructor(name, config) {
    super(name);
    this.type = 'Interface';

    this.fields = Object
      .keys(config)
      .sort()
      .map(funcName => new exports.FunctionFrame(funcName, config[funcName]));
  }
}

exports.FunctionFrame =
class FunctionFrame extends exports.Frame {
  constructor(name, config) {
    super(name);
    this.type = 'Function';
    //this.input = apiTypes.Type.from(config.input);
    //this.output = apiTypes.Type.from(config.output);
    this.input = config.input;
    this.output = config.output;
    this.impl = config.impl;
  }
}

exports.FrameBuilder =
class FrameBuilder {
  constructor(metadata) {
    this.metadata = metadata;
    this.frames = new Map;
  }

  dataFrame(name, config) {
    return this.addFrame(new exports.DataFrame(name, config));
  }
  interfaceFrame(name, config) {
    return this.addFrame(new exports.InterfaceFrame(name, config));
  }
  functionFrame(name, config) {
    return this.addFrame(new exports.FunctionFrame(name, config));
  }
  export(frame) {
    const frames = new Set(this.frames.values());
    if (!frames.has(frame)) throw new Error(`Can't export non-Frame objects`);
    this.exportedFrame = frame;
  }

  addFrame(frame) {
    if (this.frames.has(frame.name))
      throw new Error(`duplicate frame "${frame.name}"`);
    this.frames.set(frame.name, frame);
    return frame;
  }
}
