const {Framework} = require('./framework');

exports.Frame =
class Frame {
  constructor(name) {
    this.name = name;
  }
}

exports.DataFrame =
class DataFrame extends exports.Frame {
  constructor(name, config) {
    super(name);
    this.config = config; // TODO
  }
}

exports.InterfaceFrame =
class InterfaceFrame extends exports.Frame {
  constructor(name, config) {
    super(name);
    this.config = config; // TODO
  }
}

exports.FunctionFrame =
class FunctionFrame extends exports.Frame {
  constructor(name, config) {
    super(name);
    this.config = config; // TODO
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
  compile() {
    return new Framework(this);
  }

  addFrame(frame) {
    if (this.frames.has(frame.name))
      throw new Error(`duplicate frame "${frame.name}"`);
    this.frames.set(frame.name, frame);
    return frame;
  }
}
