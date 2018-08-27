class PlatformApiGetter {
  constructor(self, name, type, impl) {
    this.self = self;
    this.type = PlatformApiType.from(type, name);
    this.impl = impl;
    this.get = this.get.bind(this);
  }
  get(self=this.self) {
    return Promise
      .resolve(this.impl.call(self))
      .then(x => this.type.serialize(x));
  }
  getEntry(path) {
    if (path.length === 0) return this;
    throw new Error(`Getters don't have any children`);
  }
}

class PlatformApiFunction {
  constructor(self, name, {input, output, impl}) {
    this.self = self;
    this.inputType = PlatformApiType.from(input, 'input');
    this.outputType = PlatformApiType.from(output, 'output');
    this.impl = impl;
    this.invoke = this.invoke.bind(this);
  }
  invoke(input, self=this.self) {
    return Promise
      .resolve(this.impl.call(self, this.inputType.deserialize(input)))
      .then(x => ({
        get: () => this.outputType.serialize(x),
      }));
  }
  getEntry(path) {
    switch (path) {
      case '':
        return new FlatEnumerable(
          new StringLiteral('input'),
          new StringLiteral('output'),
          {Type: 'Function', Name: 'invoke'});
      case '/input':
        return { get: () => new StringLiteral('input', JSON.stringify(this.inputType)) };
      case '/output':
        return { get: () => new StringLiteral('output', JSON.stringify(this.outputType)) };
      case '/invoke':
        return this;
    }
  }
}

exports.PlatformApiGetter = PlatformApiGetter;
exports.PlatformApiFunction = PlatformApiFunction;
