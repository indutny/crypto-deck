'use strict';

const tape = require('tape');

const elliptic = require('elliptic');

const poker = require('../');
const Deck = poker.Deck;

const CARD_COUNT = 52;

tape('Deck', (t) => {
  const p1 = new Deck({
    cardCount: CARD_COUNT,
    curve: elliptic.curves.secp256k1.curve
  });

  const p2 = new Deck({
    cardCount: CARD_COUNT,
    curve: elliptic.curves.secp256k1.curve
  });

  // Create cards

  const c1 = p1.commit();
  t.equal(c1.length, CARD_COUNT,
          'committment length is equal to the number of cards');

  const c2 = p2.commit();
  t.equal(c1.length, c2.length, 'committments have equal length');

  p1.onCommit(c2);
  p2.onCommit(c1);

  t.ok(p1.cards.every((card, i) => {
    return p2.cards[i].eq(card);
  }), 'players have same cards');

  // Shuffle them

  const s1 = p1.shuffle();
  t.equal(s1.length, p1.cards.length,
          'shuffle length is equal to the number of cards');

  const s = p2.shuffle(s1);
  t.equal(s1.length, s.length, 'shuffles have equal length');

  // .. and lock

  const l1 = p1.lock(s);
  const l = p2.lock(l1);

  p1.onLock(l);
  p2.onLock(l);

  t.equal(p1._locked.length, p1.cards.length,
          'locked length is equal to the number of cards');
  t.equal(p1._locked.length, p2._locked.length,
          'locked length is the same');

  t.ok(p1._locked.every((card, i) => {
    return p2._locked[i].eq(card);
  }), 'players have same locked cards');

  // Draw all cards
  var out = [];
  while (!p1.isEmpty()) {
    const i = p1.getDrawIndex();
    p1.draw(i);
    const keys = [
      p1.getKey(i),
      p2.getKey(i)
    ];

    const card = p1.unlock(i, keys);
    out.push(card);
  }
  t.equal(out.length, p1.cards.length, 'Should draw all cards');

  t.end();
});
