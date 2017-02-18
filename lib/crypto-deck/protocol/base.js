'use strict';

const assert = require('minimalistic-assert');
const inherits = require('inherits');
const EventEmitter = require('events').EventEmitter;

const cryptoDeck = require('../../crypto-deck');
const Deck = cryptoDeck.Deck;
const MessageStream = cryptoDeck.MessageStream;

const FIRST_PLAYER = 0;

function Base(options) {
  EventEmitter.call(this);

  this.options = options;

  assert.equal(typeof this.options.index, 'number',
               'options.index is required (number)');
  assert.equal(typeof this.options.playerCount, 'number',
               'options.playerCount is required (number)');

  this.index = this.options.index;
  this.playerCount = this.options.playerCount;

  this.prev = this.index === 0 ? this.playerCount - 1 : this.index - 1;
  this.next = (this.index + 1) % this.playerCount;

  this._streams = {};

  this._mutexHolder = null;
  this._mutexQueue = [];

  this._initMutex();
}
inherits(Base, EventEmitter);
module.exports = Base;

Base.FIRST_PLAYER = FIRST_PLAYER;

Base.prototype._send = function _send(type, payload, target) {
  this.emit('message', { type: type, payload: payload }, target);
};

Base.prototype._error = function _error(type, error, target) {
  // TODO(indutny): use `type`
  this.emit('message', { type: 'error', error: error }, target);
};

Base.prototype.receive = function receive(msg, from) {
  if (!msg || !msg.type || !this._streams[msg.type])
    return;

  const streams = this._streams[msg.type];
  for (let i = 0; i < streams.length; i++) {
    const item = streams[i];
    if (item.from === undefined || item.from === from)
      item.stream.push({ payload: msg.payload, from: from });
  }
};

//
// High-level protocol methods
//

Base.prototype._stream = function _stream(type, from) {
  const stream = new MessageStream(type);

  const item = { stream: stream, from: from };

  let list = this._streams[type];
  if (list) {
    list.push(item);
  } else {
    list = [ item ];
    this._streams[type] = list;
  }

  stream.once('unwatch', () => {
    const index = list.indexOf(item);
    if (index !== -1)
      list.splice(index, 1);
    if (list.length === 0)
      delete this._streams[type];
  });

  return stream;
};

Base.prototype._collect = function _collect(type, self, callback) {
  const data = new Array(this.playerCount);
  for (let i = 0; i < data.length; i++)
    data[i] = null;
  assert(self !== null);
  data[this.index] = self;

  const stream = this._stream(type);
  stream.on('data', (item) => {
    if (data[item.from] !== null)
      return this._error(type, 'Duplicate message', item.from);

    data[item.from] = item.payload;
    const stillWaiting = data.some(item => item === null);
    if (stillWaiting)
      return;
    stream.unwatch();

    callback(null, data);
  });
};

Base.prototype._reduce = function _reduce(stream, reduce, callback) {
  const first = this.index === FIRST_PLAYER;

  stream.once('data', (item) => {
    stream.unwatch();

    if (first)
      return callback(null, item.payload);

    let acc;
    try {
      acc = reduce(item.payload);
    } catch (e) {
      return callback(e);
    }

    this._send(stream.type, acc, this.next);
  });

  if (!first)
    return null;

  return (data) => {
    let acc;
    try {
      acc = reduce(data);
    } catch (e) {
      stream.unwatch();
      return callback(e);
    }

    this._send(stream.type, acc, this.next);
  };
};

Base.prototype._initMutex = function _initMutex() {
  if (this.index !== FIRST_PLAYER)
    return;

  const onLocked = (unlock) => {
    this._send('mutex:baton', null, this._mutexHolder);

    const stream = this._stream('mutex:release', this._mutexHolder);
    stream.once('data', () => {
      stream.unwatch();
      unlock();
    });
  };

  const mutex = this._stream('mutex:acquire');
  mutex.on('data', (item) => {
    this._localMutex(item.from, onLocked);
  });
};

Base.prototype._mutex = function _mutex(body, callback) {
  if (this.index === FIRST_PLAYER)
    this._localMutex(this.index, body, callback);
  else
    this._remoteMutex(body, callback);
};

Base.prototype._localMutex = function _localMutex(from, body, callback) {
  if (this._mutexHolder !== null) {
    this._mutexQueue.push({ index: from, body: body, callback: callback });
    return;
  }

  const unlock = (err, data) => {
    this._mutexHolder = null;
    if (this._mutexQueue.length !== 0) {
      const item = this._mutexQueue.shift();
      this._localMutex(item.index, item.body, item.callback);
    }

    if (callback)
      callback(err, data);
  };

  this._mutexHolder = from;
  process.nextTick(body, unlock);
};

Base.prototype._remoteMutex = function _remoteMutex(body, callback) {
  if (this._mutexHolder !== null) {
    this._mutexQueue.push({ body: body, callback: callback });
    return;
  }

  this._mutexHolder = this.index;

  const unlock = (err, data) => {
    this._mutexHolder = null;
    this._send('mutex:release', null, FIRST_PLAYER);
    if (this._mutexQueue.length !== 0) {
      const item = this._mutexQueue.shift();
      this._remoteMutex(item.body, item.callback);
    }

    if (callback)
      callback(err, data);
  };

  this._send('mutex:acquire', null, FIRST_PLAYER);
  const stream = this._stream('mutex:baton', FIRST_PLAYER);
  stream.once('data', () => {
    stream.unwatch();
    body(unlock);
  });
};
