exports.Framework =
class Framework {
  constructor(builder) {
    this.metadata = builder.metadata;
    this.namedFrames = Array.from(builder.frames.values());
    this.allFrames = this.namedFrames.slice(0);
    this.exportedFrame = builder.exportedFrame.name;

    // TODO: decompose frames
  }

  newExport() {
    return new this.exportedFrame();
  }
}
