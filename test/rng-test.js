'use strict';

const tape = require('tape');

const elliptic = require('elliptic');

const cryptoDeck = require('../');
const RNG = cryptoDeck.RNG;

tape('RNG', (t) => {
  const rng = new RNG();

  function dist(num) {
    // Check that the distribution is uniform
    const out = new Array(num).fill(0);
    for (let i = 0; i < 1000000; i++) {
      const r = rng.uniform(num);
      out[r]++;
    }

    let min = Infinity;
    let max = 0;
    for (let i = 0; i < out.length; i++) {
      const count = out[i];
      if (count < min)
        min = count;
      if (count > max)
        max = count;
    }

    return { min, max };
  }

  const small = dist(2);
  t.ok(small.max / small.min < 1.15, 'numbers should be close (small)');

  const medium = dist(19);
  t.ok(medium.max / medium.min < 1.15, 'numbers should be close (medium)');

  const large = dist(52);
  t.ok(large.max / large.min < 1.15, 'numbers should be close (large)');

  const prng = new RNG(Buffer.alloc(24).fill(0xee));
  t.equal(Buffer.from(prng.bytes(32)).toString('hex'),
          'f2c2ee1da9ffa972ac5e087a649070584cf3506d21c48b2082aeea6f803f685a',
          'PRNG mode');

  t.end();
});
