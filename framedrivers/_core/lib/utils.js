// Blank line aesthetic
process.on('exit', () => console.log());

exports.ExtendableError = class ExtendableError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
}

const fs = require('fs');
const IdentityFile = process.env.SD_IDENTIFY_FILE || 'driver-identity.txt';
exports.upsertFileContents = function upsertFileContents(path, valueGetter) {
  try {
    return fs.readFileSync(path, 'utf-8');
  } catch (err) {
    switch (err.code) {
      case 'ENOENT':
        // file doesn't exist, try making it
        newBody = valueGetter()
        fs.writeFileSync(path, newBody, 'utf-8');
        return newBody;
      default:
        throw err;
    }
  }
}

exports.hashCode = function hashCode(str) {
  var hash = 0, i, chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr   = str.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};
