'use strict';

const inherits = require('inherits');
const Readable = require('stream').Readable;

function MessageStream(type) {
  Readable.call(this, { objectMode: true });
  this.type = type;
}
inherits(MessageStream, Readable);
module.exports = MessageStream;

MessageStream.prototype._read = function _read() {
};

MessageStream.prototype.unwatch = function unwatch() {
  this.push(null);
  this.emit('unwatch');
};
