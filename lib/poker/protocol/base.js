'use strict';

var assert = require('minimalistic-assert');
var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

var poker = require('../../poker');
var Deck = poker.Deck;
var MessageStream = poker.MessageStream;

var FIRST_PLAYER = 0;

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

  var streams = this._streams[msg.type];
  for (var i = 0; i < streams.length; i++) {
    var item = streams[i];
    if (item.from === undefined || item.from === from)
      item.stream.push({ payload: msg.payload, from: from });
  }
};

//
// High-level protocol methods
//

Base.prototype._stream = function _stream(type, from) {
  var stream = new MessageStream(type);

  var item = { stream: stream, from: from };

  var list = this._streams[type];
  if (list) {
    list.push(item);
  } else {
    list = [ item ];
    this._streams[type] = list;
  }

  var self = this;
  stream.once('unwatch', function() {
    var index = list.indexOf(item);
    if (index !== -1)
      list.splice(index, 1);
    if (list.length === 0)
      delete self._streams[type];
  });

  return stream;
};

Base.prototype._collect = function _collect(type, self, callback) {
  var data = new Array(this.playerCount);
  for (var i = 0; i < data.length; i++)
    data[i] = null;
  assert(self !== null);
  data[this.index] = self;

  var self = this;
  var stream = this._stream(type);
  stream.on('data', function(item) {
    if (data[item.from] !== null)
      return self._error(type, 'Duplicate message', item.from);

    data[item.from] = item.payload;
    var stillWaiting = data.some(function(item) {
      return item === null;
    });
    if (stillWaiting)
      return;
    stream.unwatch();

    callback(null, data);
  });
};

Base.prototype._reduce = function _reduce(stream, reduce, callback) {
  var self = this;
  var first = this.index === FIRST_PLAYER;

  stream.once('data', function(item) {
    stream.unwatch();

    if (first)
      return callback(null, item.payload);

    var acc;
    try {
      acc = reduce(item.payload);
    } catch (e) {
      return callback(e);
    }

    self._send(stream.type, acc, self.next);
  });

  if (!first)
    return null;

  return function feed(data) {
    var acc;
    try {
      acc = reduce(data);
    } catch (e) {
      stream.unwatch();
      return callback(e);
    }

    self._send(stream.type, acc, self.next);
  };
};

Base.prototype._initMutex = function _initMutex() {
  if (this.index !== FIRST_PLAYER)
    return;

  var self = this;
  var mutex = this._stream('mutex:acquire');
  mutex.on('data', function(item) {
    self._localMutex(item.from, onLocked);
  });

  function onLocked(unlock) {
    self._send('mutex:baton', null, self._mutexHolder);

    var stream = self._stream('mutex:release', self._mutexHolder);
    stream.once('data', function() {
      stream.unwatch();
      unlock();
    });
  }
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

  var self = this;
  this._mutexHolder = from;
  process.nextTick(function() {
    body(unlock);
  });

  function unlock() {
    self._mutexHolder = null;
    if (self._mutexQueue.length !== 0) {
      var item = self._mutexQueue.shift();
      self._localMutex(item.index, item.body, item.callback);
    }

    if (callback)
      callback.apply(null, arguments);
  }
};

Base.prototype._remoteMutex = function _remoteMutex(body, callback) {
  if (this._mutexHolder !== null) {
    this._mutexQueue.push({ body: body, callback: callback });
    return;
  }

  this._mutexHolder = this.index;

  var self = this;

  this._send('mutex:acquire', null, FIRST_PLAYER);
  var stream = this._stream('mutex:baton', FIRST_PLAYER);
  stream.once('data', function() {
    stream.unwatch();
    body(unlock);
  });

  function unlock() {
    self._mutexHolder = null;
    self._send('mutex:release', null, FIRST_PLAYER);
    if (self._mutexQueue.length !== 0) {
      var item = self._mutexQueue.shift();
      self._remoteMutex(item.body, item.callback);
    }

    if (callback)
      callback.apply(null, arguments);
  }
};
