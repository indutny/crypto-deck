'use strict';

const cryptoDeck = require('../crypto-deck');

function Shuffle(rng, num) {
  this.targets = [];
  for (let i = 0; i < num - 1; i++)
    this.targets.push(i + rng.uniform(num - i));
}
module.exports = Shuffle;

Shuffle.prototype.run = function run(list) {
  for (let i = 0; i < this.targets.length; i++) {
    const j = this.targets[i];

    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
};
