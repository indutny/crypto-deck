'use strict';

const tape = require('tape');
const debug = require('debug')('test');

const elliptic = require('elliptic');

const poker = require('../');
const Protocol = poker.Protocol;

const CARD_COUNT = 52;
const CURVE = elliptic.curves.secp256k1.curve;
const PLAYER_COUNT = 4;
const CONTROLLER = {
  validateDraw: (p, i) => {},
  draw: (p, i, v) => {},
  validateOpen: (p, i) => {},
  open: (p, i, v) => {}
};

tape('Protocol: mutex', (t) => {
  const players = [];

  for (let i = 0; i < 3; i++) {
    const player = new Protocol({
      cardCount: CARD_COUNT,
      curve: CURVE,
      controller: CONTROLLER,
      index: i,
      playerCount: PLAYER_COUNT
    });
    players.push(player);

    player.on('message', (msg, target) => {
      debug(`P${i} sent ${msg.type} to P${target}`);
      players[target].receive(msg, i);
    });
  }

  const log = [];
  let locked = false;

  function test(i, timeout) {
    players[i]._mutex((unlock) => {
      t.ok(!locked, `should not be locked #${log.length}`);
      locked = true;

      log.push(i);
      setTimeout(() => {
        locked = false;
        unlock();
      }, timeout);
    });
  }

  test(1, 50);
  test(0, 100);
  test(1, 50);
  test(2, 50);

  players[1]._mutex(function(unlock) {
    t.deepEqual(log, [ 0, 1, 2, 1 ], 'should interleave mutexes');
    t.end();
  });
});

tape('Protocol: draw all', (t) => {
  const players = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    players.push(new Protocol({
      cardCount: CARD_COUNT,
      curve: CURVE,
      controller: CONTROLLER,
      index: i,
      playerCount: PLAYER_COUNT
    }));
  }

  function send(msg, target, from) {
    process.nextTick(() => {
      if (target !== undefined) {
        debug(`P${from} sent: ${msg.type} to: P${target}`);
        return players[target].receive(msg, from);
      }

      debug(`P${from} broadcasted: ${msg.type}`);
      players.forEach((p, i) => {
        if (i !== from)
          p.receive(msg, from);
      });
    });
  }

  players.forEach((player, current) => {
    player.on('message', (msg, target) => {
      send(msg, target, current);
    });
  });

  players.forEach(player => player.start());

  const cards = [];
  function drawOne(index, done) {
    players[index].draw((err, card) => {
      if (err)
        return done(err);

      t.ok(0 <= card.value < CARD_COUNT,
           `.draw() should get valid card #${cards.length}`);
      cards.push(card);
      if (cards.length === CARD_COUNT)
        return done(null, cards);

      drawOne((index + 1) % PLAYER_COUNT, done);
    });
  }

  const opened = [];
  function openOne(index, done) {
    players[index % PLAYER_COUNT].open(index, (err, card) => {
      if (err)
        return done(err);

      opened.push(card);
      if (opened.length === CARD_COUNT)
        return done(null, opened);

      openOne(index + 1, done);
    });
  }

  function onReady() {
    drawOne(0, (err, cards) => {
      t.error(err, 'no error when drawing');
      t.equals(cards.length, CARD_COUNT, 'got right number of cards');
      openOne(0, (err, opened) => {
        t.error(err, 'no error when drawing');
        t.deepEquals(opened, cards, 'got right cards');
        t.end();
      });
    });
  }
  players[0].once('ready', onReady);
});
