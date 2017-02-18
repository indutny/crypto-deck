'use strict';

const assert = require('minimalistic-assert');
const inherits = require('inherits');

const cryptoDeck = require('../../crypto-deck');
const Deck = cryptoDeck.Deck;
const MessageStream = cryptoDeck.MessageStream;
const Base = cryptoDeck.protocol.Base;

function Protocol(options) {
  Base.call(this, options);

  assert.equal(typeof this.options.controller, 'object',
               'options.controller is required (object)');
  this.controller = this.options.controller;

  this.deck = new Deck(this.options);

  // Create streams early to not miss any messages
  this._cardStreams = {
    draw: this._stream('draw'),
    open: this._stream('open'),
    update: this._stream('update')
  };

  this.once('ready', () => {
    this._listen();
  });
}
inherits(Protocol, Base);
module.exports = Protocol;

//
// Initialization sequence
//

Protocol.prototype.start = function start() {
  const shuffle = this._stream('shuffle', this.prev);
  const lock = this._stream('lock', this.prev);
  const finalCards = this._stream('final', Base.FIRST_PLAYER);
  let feedLock = null;

  // Sequence:
  // 1. Commit
  // 2. Shuffle
  // 3. Lock

  const onShuffle = (err, points) => {
    if (err)
      return this.emit('error', err);

    if (feedLock)
      feedLock(points);
  };

  const onLock = (err, points) => {
    if (err)
      return this.emit('error', err);

    try {
      this.deck.onLock(points);
    } catch (e) {
      return this.emit('error', e);
    }
    this._send('final', points);
    this.emit('ready');
  };

  this._send('commit', this.deck.commit());
  this._collect('commit', false, (err, commits) => {
    if (err)
      return this.emit('error', err);

    try {
      for (let i = 0; i < commits.length; i++)
        if (i !== this.index)
          this.deck.onCommit(commits[i]);
    } catch (e) {
      return this.emit('error', e);
    }

    const feedShuffle = this._reduce(shuffle, (acc) => {
      return this.deck.shuffle(acc);
    }, onShuffle);
    if (feedShuffle)
      feedShuffle();

    feedLock = this._reduce(lock, (acc) => {
      return this.deck.lock(acc);
    }, onLock);

    finalCards.once('data', (item) => {
      finalCards.unwatch();

      try {
        this.deck.onLock(item.payload);
      } catch (e) {
        return this.emit('error', e);
      }

      this.emit('ready');
    });
  });
};

//
// Card Operations
//

Protocol.prototype._listen = function _listen() {
  const streams = this._cardStreams;

  streams.draw.on('data', (item) => {
    this.recvDraw(item.payload, item.from);
  });

  streams.open.on('data', (item) => {
    this.recvOpen(item.payload, item.from);
  });

  streams.update.on('data', (item) => {
    this.recvUpdate(item.payload, item.from);
  });
};

Protocol.prototype.draw = function draw(callback) {
  this._mutex((callback) => {
    const index = this.deck.getDrawIndex();

    try {
      this.controller.validateDraw(this.index, index);
    } catch (e) {
      return callback(e);
    }

    this.deck.draw(index);
    const key = this.deck.getKey(index);

    this._send('draw', index);
    this._collect('draw:key', key, (err, keys) => {
      if (err)
        return callback(err);

      let value;
      try {
        value = this.deck.unlock(index, keys);
      } catch (e) {
        return callback(e);
      }

      this.controller.draw(this.index, index, value);

      callback(null, { index: index, value: value });
    });
  }, callback);
};

Protocol.prototype.recvDraw = function recvDraw(index, from) {
  try {
    this.controller.validateDraw(from, index);
  } catch (e) {
    return this._error('draw', 'can\'t draw a card', from);
  }

  this.controller.draw(from, index, null);
  this._send('draw:key', this.deck.getKey(index), from);
};

Protocol.prototype.open = function open(index, callback) {
  this._mutex((callback) => {
    if (index === null)
      index = this.deck.getDrawIndex();

    try {
      this.controller.validateOpen(this.index, index);
    } catch (e) {
      return callback(e);
    }

    this._send('open', index);
    this._collect('open:key', this.deck.getKey(index), (err, keys) => {
      if (err)
        return callback(err);

      let value;
      try {
        value = this.deck.unlock(index, keys);
      } catch (e) {
        return callback(err);
      }

      this.controller.open(this.index, index, value);
      this._send('open:keys', keys);

      callback(null, { index: index, value: value });
    });
  }, callback);
};

Protocol.prototype.recvOpen = function recvOpen(index, from) {
  try {
    this.controller.validateOpen(from, index);
  } catch (e) {
    return this._error('open', 'can\'t open a card', from);
  }

  const key = this.deck.getKey(index);
  this._send('open:key', key, from);

  const stream = this._stream('open:keys', from);
  stream.once('data', (item) => {
    stream.unwatch();

    let value;
    try {
      value = this.deck.unlock(index, item.payload);
    } catch (e) {
      return this._error('open:keys', 'Can\'t open card', from);
    }

    this.controller.open(from, index, value);
  });
};

Protocol.prototype.update = function update(info, callback) {
  this._mutex((callback) => {
    try {
      this.controller.validateUpdate(info, this.index);
    } catch (e) {
      return callback(e);
    }

    this.controller.update(info, this.index);
    this._send('update', info);
    this._collect('update:ack', true, callback);
  }, callback);
};

Protocol.prototype.recvUpdate = function recvUpdate(update, from) {
  try {
    this.controller.validateUpdate(update, from);
  } catch (e) {
    return this._error('Failed to update the state', from);
  }
  this.controller.update(update, from);
  this._send('update:ack', true, from);
};
