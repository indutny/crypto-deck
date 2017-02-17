'use strict';

function Poker() {
  this.src = null;
}
module.exports = Poker;

Poker.prototype.draw = function draw(player, index) {
};

// NOTE: `card` may be `null`
Poker.prototype.onDraw = function onDraw(player, index, card) {
};

Poker.prototype.open = function open(player, index) {
};

Poker.prototype.onOpen = function onOpen(player, index, card) {
};
