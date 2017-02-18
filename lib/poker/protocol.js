'use strict';

var assert = require('minimalistic-assert');
var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

var poker = require('../poker');
var Deck = poker.Deck;
var MessageStream = poker.MessageStream;

var FIRST_PLAYER = 0;

function Protocol(options) {
  EventEmitter.call(this);

  this.options = options;

  assert.equal(typeof this.options.index, 'number',
               'options.index is required (number)');
  assert.equal(typeof this.options.playerCount, 'number',
               'options.playerCount is required (number)');
  assert.equal(typeof this.options.controller, 'object',
               'options.controller is required (object)');
  this.controller = this.options.controller;

  this.index = this.options.index;
  this.playerCount = this.options.playerCount;

  this.prev = this.index === 0 ? this.playerCount - 1 : this.index - 1;
  this.next = (this.index + 1) % this.playerCount;

  this.deck = new Deck(this.options);

  this._streams = {};

  this._mutexHolder = null;
  this._mutexQueue = [];

  this._initMutex();
}
inherits(Protocol, EventEmitter);
module.exports = Protocol;

Protocol.prototype._send = function _send(type, payload, target) {
  this.emit('message', { type: type, payload: payload }, target);
};

Protocol.prototype._error = function _error(type, error, target) {
  // TODO(indutny): use `type`
  this.emit('message', { type: 'error', error: error }, target);
};

Protocol.prototype.receive = function receive(msg, from) {
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

Protocol.prototype._stream = function _stream(type, from) {
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

Protocol.prototype._collect = function _collect(type, self, callback) {
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

Protocol.prototype._reduce = function _reduce(stream, reduce, callback) {
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

Protocol.prototype._initMutex = function _initMutex() {
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

Protocol.prototype._mutex = function _mutex(callback) {
  if (this.index === FIRST_PLAYER)
    this._localMutex(this.index, callback);
  else
    this._remoteMutex(callback);
};

Protocol.prototype._localMutex = function _localMutex(from, callback) {
  if (this._mutexHolder !== null) {
    this._mutexQueue.push({ index: from, callback: callback });
    return;
  }

  var self = this;
  this._mutexHolder = from;
  process.nextTick(function() {
    callback(unlock);
  });

  function unlock() {
    self._mutexHolder = null;
    if (self._mutexQueue.length === 0)
      return;

    var item = self._mutexQueue.shift();
    return self._localMutex(item.index, item.callback);
  }
};

Protocol.prototype._remoteMutex = function _remoteMutex(callback) {
  if (this._mutexHolder !== null) {
    this._mutexQueue.push(callback);
    return;
  }

  this._mutexHolder = this.index;

  var self = this;

  this._send('mutex:acquire', null, FIRST_PLAYER);
  var stream = this._stream('mutex:baton', FIRST_PLAYER);
  stream.once('data', function() {
    stream.unwatch();
    callback(unlock);
  });

  function unlock() {
    self._mutexHolder = null;
    self._send('mutex:release', null, FIRST_PLAYER);
    if (self._mutexQueue.length === 0)
      return;

    self._remoteMutex(self._mutexQueue.shift());
  }
};

//
// Initialization sequence
//

Protocol.prototype.start = function start() {
  var self = this;

  var shuffle = this._stream('shuffle', this.prev);
  var lock = this._stream('lock', this.prev);
  var finalCards = this._stream('final', FIRST_PLAYER);
  var feedLock = null;

  this._send('commit', this.deck.commit());
  this._collect('commit', false, function(err, commits) {
    if (err)
      return self.emit('error', err);

    try {
      for (var i = 0; i < commits.length; i++)
        if (i !== self.index)
          self.deck.onCommit(commits[i]);
    } catch (e) {
      return self.emit('error', e);
    }

    var feedShuffle = self._reduce(shuffle, function(acc) {
      return self.deck.shuffle(acc);
    }, onShuffle);
    if (feedShuffle)
      feedShuffle();

    feedLock = self._reduce(lock, function(acc) {
      return self.deck.lock(acc);
    }, onLock);

    finalCards.once('data', function(item) {
      finalCards.unwatch();

      try {
        self.deck.onLock(item.payload);
      } catch (e) {
        return self.emit('error', e);
      }

      self.emit('ready');
    });
  });

  function onShuffle(err, points) {
    if (err)
      return self.emit('error', err);

    if (feedLock)
      feedLock(points);
  }

  function onLock(err, points) {
    if (err)
      return self.emit('error', err);

    try {
      self.deck.onLock(points);
    } catch (e) {
      return self.emit('error', e);
    }
    self._send('final', points);
    self.emit('ready');
  }
};

//
// Card Operations
//

Protocol.prototype.draw = function draw(callback) {
  return;
  var self = this;
  var index = this.deck.draw();

  try {
    this.controller.validateDraw(this.index, index);
  } catch (e) {
    return asyncify(callback, e);
  }

  var key = this.deck.getKey(index);

  var seq = this._await('draw', key, function(err, keys) {
    if (err)
      return callback(err);

    var value;
    try {
      value = self.deck.unlock(index, keys);
    } catch (e) {
      return callback(e);
    }

    self.controller.draw(self.index, index, value);

    self._changeState('idle');

    callback(null, { index: index, value: value });
  });
  this._request(seq, 'draw', index);
};

Protocol.prototype.recvDraw = function recvDraw(msg, from) {
  try {
    this.controller.validateDraw(from, msg.payload);
  } catch (e) {
    return this._error('can\'t draw a card', from);
  }

  this.controller.draw(from, msg.payload, null);
  this._respond(msg.seq, 'draw', this.deck.getKey(msg.payload), from);
};

Protocol.prototype.open = function open(index, callback) {
  var self = this;

  try {
    this.controller.validateOpen(this.index, index);
  } catch (e) {
    return callback(e);
  }

  this._send('open', index);
  this._await('open', this.deck.getKey(index), function(err, keys) {
    if (err)
      return callback(err);

    var value;
    try {
      value = self.deck.unlock(index, keys);
    } catch (e) {
      return callback(err);
    }

    self._send('open:keys', keys);
    self._changeState('idle');
    self.controller.open(self.index, index, value);
    callback(null, { index: index, value: value });
  });
};

Protocol.prototype.recvOpen = function recvOpen(msg, from) {
  try {
    this.controller.validateOpen(from);
  } catch (e) {
    return this._error('can\'t open a card', from);
  }

  var key = this.deck.getKey(msg.payload);
  this._send('open:response', key, from);
  this._changeState('open:keys');
  this.waiting = { index: msg.payload, from: from };
};

Protocol.prototype.recvOpenKeys = function recvOpenKeys(msg, from) {
  if (msg.type !== 'open:keys' || from !== this.waiting.from)
    return this._error('Unexpected message: ' + msg.type, from);

  var value;
  try {
    value = this.deck.unlock(this.waiting.index, msg.payload);
  } catch (e) {
    return this._error('failed to unlock the card', from);
  }

  this.controller.open(from, this.waiting.index, value);
  this.waiting = null;
  this._changeState('idle');
};

Protocol.prototype.update = function update(info) {
  try {
    this.controller.validateUpdate(info, this.index);
  } catch (e) {
    return this.emit('error', e);
  }
  this.controller.update(info, this.index);
  this._send('update', info);
};

Protocol.prototype.recvUpdate = function recvUpdate(msg, from) {
  try {
    this.controller.validateUpdate(msg.payload, from);
  } catch (e) {
    return this._error('Failed to update the state', from);
  }
  this.controller.update(msg.payload, from);
};
