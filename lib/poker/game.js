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
  else if (this.state === 'draw:await')
    return this.onDrawAwaitMsg(msg, from);
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

// Game itself

Game.prototype.draw = function draw(callback) {
  try {
    this.rules.draw(this.index);
  } catch (e) {
    return asyncify(callback, e);
  }

  var index = this.deck.draw();

  var keys = new Array(this.playerCount);
  for (var i = 0; i < keys.length; i++)
    keys[i] = null;
  keys[this.index] = this.deck.getKey(index);

  this._changeState('draw:await');
  this.waiting = {
    index: index,
    keys: keys,
    callback: callback
  };

  this._send('draw', index);
};

Game.prototype.onDraw = function onDraw(msg, from) {
  try {
    this.rules.draw(from);
  } catch (e) {
    return this._error('can\'t draw a card', from);
  }

  this._send('draw:response', this.deck.getKey(msg.payload), from);
};

Game.prototype.onDrawAwaitMsg = function onDrawAwaitMsg(msg, from) {
  if (msg.type !== 'draw:response')
    return this._error('unexpected message: ' + msg.type, from);

  if (this.waiting.keys[from] !== null)
    return this._error('duplicate draw:response', from);

  this.waiting.keys[from] = msg.payload;

  var stillWaiting = this.waiting.keys.some(function(key) {
    return key === null;
  });
  if (stillWaiting)
    return;

  var callback = this.waiting.callback;

  var card;
  try {
    card = this.deck.unlock(this.waiting.index, this.waiting.keys);
  } catch (e) {
    return callback(e);
  }

  this._changeState('idle');
  this.waiting = null;

  callback(null, card);
};
