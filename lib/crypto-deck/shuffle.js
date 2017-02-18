'use strict';

var cryptoDeck = require('../crypto-deck');
var rng = new cryptoDeck.RNG();

function Shuffle(num) {
  this.targets = [];
  for (var i = 0; i < num - 1; i++)
    this.targets.push(i + rng.uniform(num - i));
}
module.exports = Shuffle;

Shuffle.prototype.run = function run(list) {
  for (var i = 0; i < this.targets.length; i++) {
    var j = this.targets[i];

    var t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
};
