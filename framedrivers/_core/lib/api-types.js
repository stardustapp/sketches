const {ExtendableError} = require('./utils');
const literals = require('./api-literals');

class PlatformTypeError extends ExtendableError {
  constructor(fieldName, expectedType, actualType) {
    super(`API field ${JSON.stringify(fieldName)} is supposed to be type ${expectedType} but was actually ${actualType}`);
    this.fieldName = fieldName;
    this.expectedType = expectedType;
    this.actualType = actualType;
  }
}

// the base type
class PlatformApiType {
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
}

class PlatformApiTypeString extends PlatformApiType {
  constructor(name, defaultValue=null, ser=String, de=String) {
    super(name, 'String');
    this.defaultValue = defaultValue;
    this.ser = ser;
    this.de = de;
  }
  serialize(value) {
    if (value == null)
      value = this.defaultValue;
    return new literals.String(this.name, this.ser(value));
  }
  deserialize(literal) {
    if (!literal) {
      if (this.defaultValue != null)
        return this.defaultValue;
      throw new PlatformTypeError(this.name, 'String', 'Empty');
    }
    if (literal.Type !== 'String')
      throw new PlatformTypeError(this.name, 'String', literal.Type);
    return this.de(literal.StringValue);
  }
}

class PlatformApiTypeEmpty extends PlatformApiType {
  constructor(name) {
    super(name, 'Empty');
  }
  serialize(value) {
    if (value != null)
      throw new Error(`Empty type can't serialize anything other than null`);
    return null;
  }
  deserialize(literal) {
    if (literal != null)
      throw new Error(`Empty type can't deserialize anything other than null`);
    return null;
  }
}

// Never put this on the network, it's a no-op, only for intra-process message passing.
class PlatformApiTypeJs extends PlatformApiType {
  constructor(name) {
    super(name, 'JS');
  }
  serialize(value) {
    return value;
  }
  deserialize(literal) {
    return literal;
  }
}

// A binary buffer and a MIME type
class PlatformApiTypeBlob extends PlatformApiType {
  constructor(name) {
    super(name, 'Blob');
  }
  serialize(value) {
    if (value === null)
      return null;
    switch (value.constructor) {
      case literals.Blob:
        return value;
      case Buffer:
        return literal.Blob.fromNodeBuffer(this.name, value);
      //case Blob:
      //  return literals.Blob.fromActual(this.name, value);
      default:
        throw new Error(`Can't express a ${value.constructor} value as a Blob literal`);
    }
  }
  deserialize(literal) {
    if (!literal)
      return null;
    if (literal.Type !== 'Blob')
      throw new PlatformTypeError(this.name, 'Blob', literal.Type);
    const blobLit = literals.hydrate(literal);
    return blobLit.asNodeBuffer();
  }
}

class PlatformApiTypeFolder extends PlatformApiType {
  constructor(name, fields=[]) {
    super(name, 'Folder');
    this.fields = fields;
  }
  serialize(value) {
    return new literals.Folder(this.name, this.fields
        .map(field => field.serialize(value[field.name])))
  }
  deserialize(literal) {
    if (!literal)
      throw new Error(
        `Folder ${
          JSON.stringify(this.name)
        } is required`);
    if (literal.Type !== 'Folder')
      throw new PlatformTypeError(this.name, 'Folder', literal.Type);

    const {Children} = literal;
    const struct = {};
    const givenKeys = new Set(Children.map(x => x.Name));
    for (const field of this.fields) {
      givenKeys.delete(field.name);
      const child = Children.find(x => x.Name === field.name);
      // TODO: transform struct keys for casing
      struct[field.name] = field.deserialize(child);
    }
    if (givenKeys.size !== 0) {
      throw new Error(
        `Folder ${
          JSON.stringify(this.name)
        } had extra children: ${
          Array.from(givenKeys).join(', ')
        }`);
    }
    return struct;
  }
}

class PlatformApiTypeTuple extends PlatformApiType {
  constructor(name, slots=[]) {
    super(name, 'Folder');
    this.slots = slots;
  }
  serialize(value) {
    if (value.length !== this.slots.length)
      throw new Error(`Tuple of ${this.slots.length} slots can't serialize ${value.length} fields`);
    return new literals.Folder(this.name, this.slots
        .map((field, idx) => {
          const literal = field.serialize(value[idx]);
          literal.Name = ''+(idx+1);
          return literal;
        }));
  }
  deserialize(literal) {
    if (!literal)
      throw new Error(
        `Tuple ${
          JSON.stringify(this.name)
        } is required`);
    if (literal.Type !== 'Folder')
      throw new PlatformTypeError(this.name, 'Folder', literal.Type);
    if (literal.Children.length !== this.slots.length)
      throw new Error(`Tuple of ${this.slots.length} slots can't deserialize ${value.length} fields`);

    const {Children} = literal;
    const array = new Array(this.slots.length);
    const givenKeys = new Set(Children.map(x => x.Name));
    this.slots.forEach((slot, idx) => {
      givenKeys.delete(''+(idx+1));
      const child = Children.find(x => x.Name === field.name);
      // TODO: transform struct keys for casing
      array[idx] = field.deserialize(child);
    });
    if (givenKeys.size !== 0) {
      throw new Error(
        `Tuple ${
          JSON.stringify(this.name)
        } had extra children: ${
          Array.from(givenKeys).join(', ')
        }`);
    }
    return array;
  }
}

PlatformApiType.from = function TypeFromRaw(source, name) {
  if (source == null)
    return new PlatformApiTypeEmpty(name);

  // recognize a constructor vs. a literal default-value
  const sourceIsBareFunc = source.constructor === Function || source === JSON;
  const typeFunc = sourceIsBareFunc ? source : source.constructor;
  const givenValue = sourceIsBareFunc ? null : source;

  //console.log('schema', name, 'type', typeFunc, 'default', givenValue);
  switch (typeFunc) {

    // string-based literals
    case String:
      return new PlatformApiTypeString(name, givenValue);
    case Number:
      return new PlatformApiTypeString(name, givenValue,
          String,
          parseFloat);
    case Boolean:
      return new PlatformApiTypeString(name, givenValue,
          b => b ? 'yes' : 'no',
          s => ({yes: true, no: false})[s]);
    case JSON:
      return new PlatformApiTypeString(name, givenValue,
          b => JSON.stringify(b),
          s => JSON.parse(s));

    // nested data structures
    case Object: // TODO: better way to detect structures
      if (sourceIsBareFunc) {
        // blackbox objects become JSON strings lol fite me
        return new PlatformApiTypeString(name, {},
            JSON.stringify,
            JSON.parse);
      } else {
        const fields = Object
            .keys(givenValue)
            .map(name => PlatformApiType
                .from(givenValue[name], name));
        return new PlatformApiTypeFolder(name, fields);
      }

    case PlatformApi:
      if (sourceIsBareFunc)
        throw new Error(`PlatformApi must be passed as a created instance`);
      if (givenValue.structType.name)
        throw new Error(`BUG: reused PlatformApi renaming`);
      givenValue.structType.name = name;
      return givenValue.structType;

    case Symbol:
      switch (givenValue) {
        case Symbol.for('raw js object'):
          return new PlatformApiTypeJs(name);

      }
    default:
      throw new Error(`Unable to implement type for field ${JSON.stringify(name)}`);
  }
}

module.exports = {
  Type: PlatformApiType,

  Error: PlatformTypeError,
  String: PlatformApiTypeString,
  Empty: PlatformApiTypeEmpty,
  Js: PlatformApiTypeJs,
  Folder: PlatformApiTypeFolder,
  Tuple: PlatformApiTypeTuple,
};
