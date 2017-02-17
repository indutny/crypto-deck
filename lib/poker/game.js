'use strict';

var assert = require('minimalistic-assert');
var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

var poker = require('../poker');
var Deck = poker.Deck;

function Player() {
  this.hand = 0;
}

function Game(options) {
  EventEmitter.call(this);

  this.options = options;

  assert.equal(typeof this.options.index, 'number',
               'options.index is required (number)');
  assert.equal(typeof this.options.playerCount, 'number',
               'options.players is required (number)');
  assert.equal(typeof this.options.rules, 'object',
               'options.rules is required (object)');
  this.rules = this.options.rules;

  this.index = this.options.index;
  this.playerCount = this.options.playerCount;
  this.players = new Array(this.playerCount);
  for (var i = 0; i < this.players.length; i++)
    this.players[i] = new Player();

  this.prev = this.index === 0 ? this.playerCount - 1 : this.index - 1;
  this.next = (this.index + 1) % this.playerCount;

  this.deck = new Deck(this.options);

  this.state = null;
  this.waiting = null;
  this._idleQueue = [];
}
inherits(Game, EventEmitter);
module.exports = Game;

function asyncify(callback, err, data) {
  setImmediate(function() {
    callback(err, data);
  });
}

Game.prototype._send = function _send(type, payload, dest) {
  this.emit('message', { type: type, payload: payload }, dest);
};

Game.prototype._error = function _error(payload, dest) {
  throw new Error(payload);
  this.emit('message', { type: 'error', payload: payload }, dest);
};

Game.prototype._changeState = function _changeState(state) {
  this.emit('stateChange', this.state, state);
  this.state = state;
  if (state === 'idle') {
    this.emit('idle');
    var queue = this._idleQueue;
    this._idleQueue = [];
    for (var i = 0; i < queue.length; i++)
      queue[i]();
  }
};

Game.prototype.receive = function receive(msg, from) {
  if (this.state === 'init:shuffle')
    return this.recvShuffleMsg(msg, from);
  else if (this.state === 'init:lock')
    return this.recvLockMsg(msg, from);
  else if (this.state === 'init:pre-ready')
    return this.recvPreGameMsg(msg, from);
  else if (this.state === 'idle')
    return this.recvIdleMsg(msg, from);
  else if (this.state === 'open:keys')
    return this.recvOpenKeys(msg, from);
  else if (/^await:/.test(this.state))
    return this.recvAwaitMsg(msg, from);
};

// Initialization sequence

Game.prototype.start = function start() {
  assert(this.state === null, 'start() must be called just once');

  var self = this;

  var cards = this.deck.commit();
  this._send('init:response', cards);

  this._await('init', false, function(err, points) {
    if (err)
      return self.emit('error', err);

    try {
      for (var i = 0; i < points.length; i++) {
        if (points[i] !== false)
          self.deck.onCommit(points[i]);
      }
    } catch (e) {
      return self.emit('error', e);
    }

    self._changeState('init:shuffle');

    if (self.index === 0)
      self._send('shuffle', self.deck.shuffle(), self.next);
  });
};

Game.prototype.recvShuffleMsg = function recvShuffleMsg(msg, from) {
  if (msg.type !== 'shuffle')
    return this._error('unexpected message: ' + msg.type, from);

  if (from !== this.prev)
    return this._error('unexpected shuffle order', from);

  if (this.index === 0) {
    var lock;
    try {
      lock = this.deck.lock(msg.payload);
    } catch (e) {
      return this._error('invalid shuffle payload', from);
    }

    this._changeState('init:pre-ready');
    return this._send('lock', lock, this.next);
  }

  var shuffle;
  try {
    shuffle = this.deck.shuffle(msg.payload);
  } catch (e) {
    return this._error('invalid shuffle payload', from);
  }

  this._changeState('init:lock');
  this._send('shuffle', shuffle, this.next);
};

Game.prototype.recvLockMsg = function recvLockMsg(msg, from) {
  if (msg.type !== 'lock')
    return this._error('unexpected message: ' + msg.type, from);

  if (from !== this.prev)
    return this._error('unexpected lock order', from);

  var lock;
  try {
    lock = this.deck.lock(msg.payload);
  } catch (e) {
    return this._error('invalid lock payload', from);
  }

  // Last player broadcasts locked cards
  if (this.index === this.playerCount - 1) {
    try {
      this.deck.onLock(lock);
    } catch (e) {
      return this._error('invalid lock payload', from);
    }

    this._changeState('idle');
    return this._send('lock', lock);
  }

  this._changeState('init:pre-ready');
  this._send('lock', lock, this.next);
};

Game.prototype.recvPreGameMsg = function recvPreGameMsg(msg, from) {
  if (msg.type !== 'lock')
    return this._error('unexpected message: ' + msg.type, from);

  try {
    this.deck.onLock(msg.payload);
  } catch (e) {
    return this._error('invalid lock payload', from);
  }

  this._changeState('idle');
};

Game.prototype.recvIdleMsg = function recvIdleMsg(msg, from) {
  if (msg.type === 'draw')
    return this.recvDraw(msg, from);
  else if (msg.type === 'open')
    return this.recvOpen(msg, from);
  else
    return this._error('unexpected message: ' + msg.type, from);
};

// Helpers

Game.prototype._await = function _await(type, self, callback) {
  var data = new Array(this.playerCount);
  for (var i = 0; i < data.length; i++)
    data[i] = null;
  data[this.index] = self;

  this._changeState('await:' + type);
  this.waiting = {
    type: type,
    data: data,
    callback: callback
  };
};

Game.prototype.recvAwaitMsg = function recvAwaitMsg(msg, from) {
  var waiting = this.waiting;
  if (msg.type !== waiting.type + ':response') {
    return this._error(
        'unexpected message: ' + msg.type + ' during await: ' + waiting.type,
        from);
  }

  if (waiting.data[from] !== null)
    return this._error('duplicate await:' + waiting.type + ' response', from);

  waiting.data[from] = msg.payload;

  var stillWaiting = waiting.data.some(function(key) {
    return key === null;
  });
  if (stillWaiting)
    return;

  this.waiting = null;
  waiting.callback(null, waiting.data);
};

// Game itself

Game.prototype.draw = function draw(callback) {
  var self = this;
  if (this.state !== 'idle') {
    this._idleQueue.push(function() {
      self.draw(index, callback);
    });
    return;
  }

  try {
    this.rules.draw(this.index);
  } catch (e) {
    return asyncify(callback, e);
  }

  var index = this.deck.draw();
  var key = this.deck.getKey(index);

  this._send('draw', index);
  this._await('draw', key, function(err, keys) {
    if (err)
      return callback(err);

    var value;
    try {
      value = self.deck.unlock(index, keys);
    } catch (e) {
      return callback(e);
    }

    self.rules.onDraw(self.index, index, value);

    self._changeState('idle');

    callback(null, { index: index, value: value });
  });
};

Game.prototype.recvDraw = function recvDraw(msg, from) {
  try {
    this.rules.draw(from);
  } catch (e) {
    return this._error('can\'t draw a card', from);
  }

  this.rules.onDraw(from, msg.payload, null);
  this._send('draw:response', this.deck.getKey(msg.payload), from);
};

Game.prototype.open = function open(index, callback) {
  var self = this;
  if (this.state !== 'idle') {
    this._idleQueue.push(function() {
      self.open(index, callback);
    });
    return;
  }

  try {
    this.rules.open(this.index, index);
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
    self.rules.onOpen(self.index, index, value);
    callback(null, { index: index, value: value });
  });
};

Game.prototype.recvOpen = function recvOpen(msg, from) {
  try {
    this.rules.open(from);
  } catch (e) {
    return this._error('can\'t open a card', from);
  }

  var key = this.deck.getKey(msg.payload);
  this._send('open:response', key, from);
  this._changeState('open:keys');
  this.waiting = { index: msg.payload, from: from };
};

Game.prototype.recvOpenKeys = function recvOpenKeys(msg, from) {
  if (msg.type !== 'open:keys' || from !== this.waiting.from)
    return this._error('Unexpected message: ' + msg.type, from);

  var value;
  try {
    value = this.deck.unlock(this.waiting.index, msg.payload);
  } catch (e) {
    return this._error('failed to unlock the card', from);
  }

  this.rules.onOpen(from, this.waiting.index, value);
  this.waiting = null;
  this._changeState('idle');
};
