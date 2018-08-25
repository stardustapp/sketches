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

// Blank line aesthetic
process.on('exit', () => console.log());
