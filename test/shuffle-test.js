'use strict';

const tape = require('tape');

const elliptic = require('elliptic');

const cryptoDeck = require('../');
const rng = new cryptoDeck.RNG();
const Shuffle = cryptoDeck.Shuffle;

tape('Shuffle', (t) => {
  function dist(num) {
    // Check that the distribution is uniform
    const out = new Array(num);
    for (let i = 0; i < out.length; i++)
      out[i] = i;

    const res = {};
    for (let i = 0; i < 1000000; i++) {
      const shuffle = new Shuffle(rng, num);
      const t = shuffle.run(out.slice());
      const key = t.join(':');
      if (res[key] === undefined)
        res[key] = 1;
      else
        res[key]++;
    }

    let min = Infinity;
    let max = 0;
    Object.keys(res).forEach((key) => {
      const count = res[key];
      if (count < min)
        min = count;
      if (count > max)
        max = count;
    });

    return { min, max, keys: Object.keys(res).length };
  }

  const small = dist(2);
  t.ok(small.max / small.min < 1.15, 'numbers should be close (small)');
  t.equal(small.keys, 2, 'all keys should be emitted (small)');

  const medium = dist(3);
  t.ok(medium.max / medium.min < 1.15, 'numbers should be close (medium)');
  t.equal(medium.keys, 6, 'all keys should be emitted (medium)');

  const large = dist(5);
  t.ok(large.max / large.min < 1.15, 'numbers should be close (large)');
  t.equal(large.keys, 120, 'all keys should be emitted (large)');

  t.end();
});
