'use strict';

const tape = require('tape');
const debug = require('debug')('test');

const elliptic = require('elliptic');

const poker = require('../');
const Game = poker.Game;

const CARD_COUNT = 52;
const CURVE = elliptic.curves.secp256k1.curve;
const PLAYER_COUNT = 4;

tape('Game: draw all', (t) => {
  const players = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    players.push(new Game({
      cards: CARD_COUNT,
      curve: CURVE,
      rules: {
        draw: () => {},
        onDraw: () => {},
        open: () => {},
        onOpen: () => {}
      },
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
    player.on('stateChange', (from, to) => {
      debug(`P${current} changed state from: ${from} to: ${to}`);
    });

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

      t.ok(0 <= card.number < CARD_COUNT,
           `.draw() should get valid card #${cards.length}`);
      cards.push(card);
      if (cards.length === CARD_COUNT)
        return done(null, cards);

      drawOne((index + 1) % PLAYER_COUNT, done);
    });
  }

  function onReady() {
    drawOne(0, (err, cards) => {
      t.error(err, 'no error when drawing');
      t.equals(cards.length, CARD_COUNT);
      t.end();
    });
  }
  players[0].on('ready', onReady);
});
