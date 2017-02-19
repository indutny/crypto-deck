'use strict';

const brorand = require('brorand');
const hash = require('hash.js');
const elliptic = require('elliptic');
const BN = require('bn.js');

const RAND_BLOCK = 64;

function RNG(entropy) {
  this.entropy = entropy || null;
  this.drbg = null;
  this.src = null;
}
module.exports = RNG;

RNG.prototype.bytes = function bytes(n) {
  if (this.entropy === null)
    return brorand(n);

  if (this.drbg === null) {
    this.drbg = new elliptic.hmacDRBG({
      hash: hash.sha512,
      entropy: this.entropy,
      seed: [],
      pers: [ 0xde, 0xcc, 0xca, 0xad ]
    });
  }

  return this.drbg.generate(n);
};

RNG.prototype.uniform = function uniform(max) {
  let p = 1;
  let bits;
  for (bits = 0; p <= max; bits++)
    p <<= 1;

  for (;;) {
    if (this.src === null || this.src.bitLength() < bits)
      this.src = new BN(this.bytes(RAND_BLOCK));

    const num = this.src.modn(p);
    this.src.ishrn(bits);

    if (num >= max)
      continue;

    return num;
  }
};
