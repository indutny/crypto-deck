'use strict';

var brorand = require('brorand');
var BN = require('bn.js');

var RAND_BLOCK = 64;

function RNG() {
  this.src = null;
}
module.exports = RNG;

RNG.prototype.uniform = function uniform(max) {
  var p = 1;
  for (var bits = 0; p <= max; bits++)
    p <<= 1;

  for (;;) {
    if (this.src === null || this.src.bitLength() < bits)
      this.src = new BN(brorand(RAND_BLOCK));

    var num = this.src.modn(p);
    this.src.ishrn(bits);

    if (num >= max)
      continue;

    return num;
  }
};
