'use strict';

const tape = require('tape');

const elliptic = require('elliptic');

const poker = require('../');
const RNG = poker.RNG;

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

  t.end();
});
