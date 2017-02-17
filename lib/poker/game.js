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
  var ready = state === 'init:ready';
  if (ready)
    state = 'idle';

  this.emit('stateChange', this.state, state);
  this.state = state;

  if (ready)
    this.emit('ready');
};

Game.prototype.receive = function receive(msg, from) {
  if (this.state === 'init:commit')
    return this.onCommitMsg(msg, from);
  else if (this.state === 'init:shuffle')
    return this.onShuffleMsg(msg, from);
  else if (this.state === 'init:lock')
    return this.onLockMsg(msg, from);
  else if (this.state === 'init:pre-ready')
    return this.onPreGameMsg(msg, from);
  else if (this.state === 'idle')
    return this.onIdleMsg(msg, from);
  else if (/^await:/.test(this.state))
    return this.onAwaitMsg(msg, from);
};

// Initialization sequence

Game.prototype.start = function start() {
  assert(this.state === null, 'start() must be called just once');

  this._changeState('init:commit');
  this.waiting = new Array(this.playerCount);
  for (var i = 0; i < this.waiting.length; i++)
    this.waiting[i] = true;
  this.waiting[this.index] = false;

  var cards = this.deck.commit();
  this._send('commit', cards);
};

Game.prototype.onCommitMsg = function onCommitMsg(msg, from) {
  if (msg.type !== 'commit')
    return this._error('unexpected message: ' + msg.type, from);

  if (!this.waiting[from])
    return this._error('duplicate commit message', from);
  this.waiting[from] = false;

  try {
    this.deck.onCommit(msg.payload);
  } catch (e) {
    return this._error('invalid commit payload', from);
  }

  var stillWaiting = this.waiting.some(function(w) {
    return w;
  });
  if (stillWaiting)
    return;

  this._changeState('init:shuffle');
  this.waiting = null;

  if (this.index === 0)
    this._send('shuffle', this.deck.shuffle(), this.next);
};

Game.prototype.onShuffleMsg = function onShuffleMsg(msg, from) {
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

Game.prototype.onLockMsg = function onLockMsg(msg, from) {
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

    this._changeState('init:ready');
    return this._send('lock', lock);
  }

  this._changeState('init:pre-ready');
  this._send('lock', lock, this.next);
};

Game.prototype.onPreGameMsg = function onPreGameMsg(msg, from) {
  if (msg.type !== 'lock')
    return this._error('unexpected message: ' + msg.type, from);

  try {
    this.deck.onLock(msg.payload);
  } catch (e) {
    return this._error('invalid lock payload', from);
  }

  this._changeState('init:ready');
};

Game.prototype.onIdleMsg = function onIdleMsg(msg, from) {
  if (msg.type === 'draw')
    return this.onDraw(msg, from);
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

Game.prototype.onAwaitMsg = function onAwaitMsg(msg, from) {
  var waiting = this.waiting;
  if (msg.type !== waiting.type + ':response')
    return this._error('unexpected message: ' + msg.type, from);

  if (waiting.data[from] !== null)
    return this._error('duplicate await:' + waiting.type + ' response', from);

  waiting.data[from] = msg.payload;

  var stillWaiting = waiting.data.some(function(key) {
    return key === null;
  });
  if (stillWaiting)
    return;

  waiting.callback(null, waiting.data);
};

// Game itself

Game.prototype.draw = function draw(callback) {
  try {
    this.rules.draw(this.index);
  } catch (e) {
    return asyncify(callback, e);
  }

  var self = this;
  var index = this.deck.draw();
  var key = this.deck.getKey(index);

  this._send('draw', index);
  this._await('draw', key, function(err, keys) {
    if (err)
      return callback(err);

    var number;
    try {
      number = self.deck.unlock(index, keys);
    } catch (e) {
      return callback(e);
    }

    self.rules.onDraw(index, number);

    self._changeState('idle');
    self.waiting = null;

    callback(null, { index: index, number: number });
  });
};

Game.prototype.onDraw = function onDraw(msg, from) {
  try {
    this.rules.draw(from);
  } catch (e) {
    return this._error('can\'t draw a card', from);
  }

  this._send('draw:response', this.deck.getKey(msg.payload), from);
};
