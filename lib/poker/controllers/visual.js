'use strict';

var assert = require('minimalistic-assert');
var inherits = require('inherits');

var EventEmitter = require('events').EventEmitter;

function Card() {
  this.owner = null;
  this.value = null;
}

function Visual(options) {
  EventEmitter.call(this);

  this.options = options;
  assert.equal(typeof this.options.cardCount, 'number',
               'options.cardCount is required (number)');

  this.cards = new Array(this.options.cardCount);
  for (var i = 0; i < this.cards.length; i++)
    this.cards[i] = new Card();
}
inherits(Visual, EventEmitter);
module.exports = Visual;


//
// Hooks
//

Visual.prototype.validateUpdate = function validateUpdate(msg, from) {
  throw new Error('Not supported');
};

Visual.prototype.update = function update(msg, from) {
};

Visual.prototype.validateDraw = function validateDraw(player, index) {
  var card = this.cards[index];
  if (card.owner !== null)
    throw new Error('Can\'t draw other\'s card');
};

// NOTE: `value` may be `null`
Visual.prototype.draw = function draw(player, index, value) {
  var card = this.cards[index];
  card.owner = player;
  card.value = value;

  this.emit('update', { index: index, card: card });
};

Visual.prototype.validateOpen = function validateOpen(player, index) {
  var card = this.cards[index];
  if (card.owner !== player && card.owner !== null)
    throw new Error('Can\'t open other\'s card');
};

Visual.prototype.open = function open(player, index, value) {
  var card = this.cards[index];
  card.value = value;

  this.emit('update', { index: index, card: card });
};
