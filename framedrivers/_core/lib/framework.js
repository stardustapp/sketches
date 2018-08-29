const {DataFrame, InterfaceFrame, FunctionFrame} = require('./frame-factory');
const apiTypes = require('./api-types');
const {hashCode} = require('./utils');

exports.Framework =
class Framework {
  constructor(builder) {
    this.metadata = builder.metadata;
    this.frames = new Map; // id -> structure
    this.names = new Map; // name -> id
    //this.frames = Array.from(builder.frames.values());

    const walkFrame = (frame) => {
      switch (frame.constructor) {
        case DataFrame:
          frame.hash = hashCode('frame-data'+frame.fields.map(x => `\n${x.name}`).sort().join(''));
          this.frames.set(frame.hash, frame);
          if (frame.name) this.names.set(frame.name, frame);
          break;
        case InterfaceFrame:
          throw new Error(`bad interface frame`);
          break;
        case FunctionFrame:
          const inputFrame = walkFrame(frame.input);
          const outputFrame = walkFrame(frame.output);
          console.log(frame.name, inputFrame, outputFrame);
          break;

        case Object:
          return walkFrame(new DataFrame('', {fields: frame}))
          break;

        default:
          throw new Error(`bad frame ${frame.constructor}`);
      }
    }
    walkFrame(builder.exportedFrame);
  }

  describe() {
    return {
      metadata: this.metadata,
      frames: Array.from(this.frames.values()),
    };
  }

  newExport() {
    return new this.exportedFrame();
  }
}
