'use strict';
const assert = require('minimalistic-assert');
const BN = require('bn.js');

const cryptoDeck = require('../crypto-deck');
const Shuffle = cryptoDeck.Shuffle;

function Deck(options) {
  this.options = options;
  assert.equal(typeof this.options.curve, 'object',
               'options.curve is required (object)');
  assert.equal(typeof this.options.cardCount, 'number',
               'options.cardCount is required (number)');
  assert(this.options.cardCount <= 0xff, 'Can\'t have more than 255 cards');

  this.curve = this.options.curve;
  this.cards = [];

  this.rng = new cryptoDeck.RNG(this.options.entropy);

  this._shuffle = new Shuffle(this.rng, this.options.cardCount);
  this._shuffleSecret = this._randScalar();

  this._lockSecrets = [];
  this._locked = [];

  this._drawn = [];
  for (let i = 0; i < this.options.cardCount; i++) {
    this._lockSecrets.push(this._randScalar());
    this._drawn.push(false);
  }
}
module.exports = Deck;

function fromPoint(p) {
  return p.encode('hex', true)
}

Deck.prototype._randScalar = function _randScalar() {
  const byteSize = this.curve.n.byteLength();
  const bitLength = this.curve.n.bitLength();
  let rnd;
  do {
    rnd = new BN(this.rng.bytes(byteSize)).umod(this.curve.n);
  } while (rnd.bitLength() < bitLength);
  return rnd;
};

Deck.prototype.commit = function commit() {
  assert.equal(this.cards.length, 0, 'Already committed');

  for (let i = 0; i < this.options.cardCount; i++)
    this.cards.push(this.curve.g.mul(this._randScalar()));

  return this.cards.map(fromPoint);
};

Deck.prototype.onCommit = function onCommit(points) {
  assert(this.cards.length !== 0, 'Should commit first');
  assert.equal(this.cards.length, points.length, 'Wrong point number');

  for (let i = 0; i < points.length; i++) {
    const p = this.curve.decodePoint(points[i], 'hex');
    this.cards[i] = this.cards[i].add(p);
  }
};

Deck.prototype.shuffle = function shuffle(points) {
  let shuffled;
  if (points) {
    assert.equal(points.length, this.cards.length, 'Wrong point number');
    shuffled = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const p = this.curve.decodePoint(points[i], 'hex');
      shuffled[i] = p;
    }
  } else {
    shuffled = this.cards.slice();
  }

  // Dumb randomized shuffle
  this._shuffle.run(shuffled);

  // Encrypt
  for (let i = 0; i < shuffled.length; i++)
    shuffled[i] = shuffled[i].mul(this._shuffleSecret);

  return shuffled.map(fromPoint);
};

Deck.prototype.lock = function lock(points) {
  const revSecret = this._shuffleSecret.invm(this.curve.n);

  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = this.curve.decodePoint(points[i], 'hex');
    out.push(p.mul(revSecret).mul(this._lockSecrets[i]));
  }
  return out.map(fromPoint);
};

Deck.prototype.onLock = function onLock(points) {
  assert.equal(this._locked.length, 0, 'already locked');

  for (let i = 0; i < points.length; i++) {
    const p = this.curve.decodePoint(points[i], 'hex');
    this._locked.push(p);
  }
};

Deck.prototype.isEmpty = function isEmpty() {
  for (let i = 0; i < this._locked.length; i++)
    if (this._drawn[i] === false)
      return false;
  return true;
};

Deck.prototype.getDrawIndex = function getDrawIndex() {
  let i;
  for (i = 0; i < this._locked.length; i++)
    if (this._drawn[i] === false)
      break;
  assert(i < this._locked.length, 'No more cards to draw');

  return i;
};

Deck.prototype.draw = function draw(index) {
  if (index === undefined)
    index = this.getDrawIndex();
  this._drawn[index] = true;
  return index;
};

Deck.prototype.getKey = function getKey(index) {
  this._drawn[index] = true;
  return this._lockSecrets[index].invm(this.curve.n).toString(16);
};

Deck.prototype.unlock = function unlock(index, keys) {
  let p = this._locked[index];
  for (let i = 0; i < keys.length; i++) {
    const key = new BN(keys[i], 16);
    p = p.mul(key);
  }

  for (let i = 0; i < this.cards.length; i++)
    if (this.cards[i].eq(p))
      return i;

  assert(false, 'Failed to unlock the card');
};
