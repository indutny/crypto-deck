'use strict';

var assert = require('minimalistic-assert');
var inherits = require('inherits');

var cryptoDeck = require('../../crypto-deck');
var Deck = cryptoDeck.Deck;
var MessageStream = cryptoDeck.MessageStream;
var Base = cryptoDeck.protocol.Base;

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

  var self = this;
  this.once('ready', function() {
    self._listen();
  });
}
inherits(Protocol, Base);
module.exports = Protocol;

//
// Initialization sequence
//

Protocol.prototype.start = function start() {
  var self = this;

  var shuffle = this._stream('shuffle', this.prev);
  var lock = this._stream('lock', this.prev);
  var finalCards = this._stream('final', Base.FIRST_PLAYER);
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

Protocol.prototype._listen = function _listen() {
  var self = this;
  var streams = this._cardStreams;

  streams.draw.on('data', function(item) {
    self.recvDraw(item.payload, item.from);
  });

  streams.open.on('data', function(item) {
    self.recvOpen(item.payload, item.from);
  });

  streams.update.on('data', function(item) {
    self.recvUpdate(item.payload, item.from);
  });
};

Protocol.prototype.draw = function draw(callback) {
  var self = this;
  this._mutex(function(callback) {
    var index = self.deck.getDrawIndex();

    try {
      self.controller.validateDraw(self.index, index);
    } catch (e) {
      return callback(e);
    }

    self.deck.draw(index);
    var key = self.deck.getKey(index);

    self._send('draw', index);
    self._collect('draw:key', key, function(err, keys) {
      if (err)
        return callback(err);

      var value;
      try {
        value = self.deck.unlock(index, keys);
      } catch (e) {
        return callback(e);
      }

      self.controller.draw(self.index, index, value);

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
  var self = this;

  this._mutex(function(callback) {
    if (index === null)
      index = self.deck.getDrawIndex();

    try {
      self.controller.validateOpen(self.index, index);
    } catch (e) {
      return callback(e);
    }

    self._send('open', index);
    self._collect('open:key', self.deck.getKey(index), function(err, keys) {
      if (err)
        return callback(err);

      var value;
      try {
        value = self.deck.unlock(index, keys);
      } catch (e) {
        return callback(err);
      }

      self.controller.open(self.index, index, value);
      self._send('open:keys', keys);

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

  var key = this.deck.getKey(index);
  this._send('open:key', key, from);

  var self = this;
  var stream = this._stream('open:keys', from);
  stream.once('data', function(item) {
    stream.unwatch();

    var value;
    try {
      value = self.deck.unlock(index, item.payload);
    } catch (e) {
      return self._error('open:keys', 'Can\'t open card', from);
    }

    self.controller.open(from, index, value);
  });
};

Protocol.prototype.update = function update(info, callback) {
  var self = this;
  this._mutex(function(callback) {
    try {
      self.controller.validateUpdate(info, self.index);
    } catch (e) {
      return callback(e);
    }

    self.controller.update(info, self.index);
    self._send('update', info);
    self._collect('update:ack', true, callback);
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
