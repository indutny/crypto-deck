'use strict';
var assert = require('minimalistic-assert');
var brorand = require('brorand');
var BN = require('bn.js');

var poker = require('../poker');
var Shuffle = poker.Shuffle;

function Deck(options) {
  this.options = options;
  assert.equal(typeof this.options.curve, 'object',
               'options.curve is required (object)');
  assert.equal(typeof this.options.cardCount, 'number',
               'options.cardCount is required (number)');
  assert(this.options.cardCount <= 0xff, 'Can\'t have more than 255 cards');

  this.curve = this.options.curve;
  this.cards = [];

  this._shuffle = new Shuffle(this.options.cardCount);
  this._shuffleSecret = this._randScalar();

  this._lockSecrets = [];
  this._locked = [];

  this._drawn = [];
  for (var i = 0; i < this.options.cardCount; i++) {
    this._lockSecrets.push(this._randScalar());
    this._drawn.push(false);
  }
}
module.exports = Deck;

function fromPoint(p) {
  return p.encode('hex', true)
}

Deck.prototype._randScalar = function _randScalar() {
  var byteSize = this.curve.n.byteLength();
  var bitLength = this.curve.n.bitLength();
  var rnd;
  do {
    rnd = new BN(brorand(byteSize)).umod(this.curve.n);
  } while (rnd.bitLength() < bitLength);
  return rnd;
};

Deck.prototype.commit = function commit() {
  assert.equal(this.cards.length, 0, 'Already committed');

  for (var i = 0; i < this.options.cardCount; i++)
    this.cards.push(this.curve.g.mul(this._randScalar()));

  return this.cards.map(fromPoint);
};

Deck.prototype.onCommit = function onCommit(points) {
  assert(this.cards.length !== 0, 'Should commit first');
  assert.equal(this.cards.length, points.length, 'Wrong point number');

  for (var i = 0; i < points.length; i++) {
    var p = this.curve.decodePoint(points[i], 'hex');
    this.cards[i] = this.cards[i].add(p);
  }
};

Deck.prototype.shuffle = function shuffle(points) {
  var shuffled;
  if (points) {
    assert.equal(points.length, this.cards.length, 'Wrong point number');
    shuffled = new Array(points.length);
    for (var i = 0; i < points.length; i++) {
      var p = this.curve.decodePoint(points[i], 'hex');
      shuffled[i] = p;
    }
  } else {
    shuffled = this.cards.slice();
  }

  // Dumb randomized shuffle
  this._shuffle.run(shuffled);

  // Encrypt
  for (var i = 0; i < shuffled.length; i++)
    shuffled[i] = shuffled[i].mul(this._shuffleSecret);

  return shuffled.map(fromPoint);
};

Deck.prototype.lock = function lock(points) {
  var revSecret = this._shuffleSecret.invm(this.curve.n);

  var out = [];
  for (var i = 0; i < points.length; i++) {
    var p = this.curve.decodePoint(points[i], 'hex');
    out.push(p.mul(revSecret).mul(this._lockSecrets[i]));
  }
  return out.map(fromPoint);
};

Deck.prototype.onLock = function onLock(points) {
  assert.equal(this._locked.length, 0, 'already locked');

  for (var i = 0; i < points.length; i++) {
    var p = this.curve.decodePoint(points[i], 'hex');
    this._locked.push(p);
  }
};

Deck.prototype.isEmpty = function isEmpty() {
  for (var i = 0; i < this._locked.length; i++)
    if (this._drawn[i] === false)
      return false;
  return true;
};

Deck.prototype.draw = function draw() {
  for (var i = 0; i < this._locked.length; i++)
    if (this._drawn[i] === false)
      break;
  assert(i < this._locked.length, 'No more cards to draw');

  this._drawn[i] = true;
  return i;
};

Deck.prototype.getKey = function getKey(index) {
  this._drawn[index] = true;
  return this._lockSecrets[index].invm(this.curve.n).toString(16);
};

Deck.prototype.unlock = function unlock(index, keys) {
  var p = this._locked[index];
  for (var i = 0; i < keys.length; i++) {
    var key = new BN(keys[i], 16);
    p = p.mul(key);
  }

  for (var i = 0; i < this.cards.length; i++)
    if (this.cards[i].eq(p))
      return i;

  assert(false, 'Failed to unlock the card');
};
