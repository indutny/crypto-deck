'use strict';

var poker = require('../');

var elliptic = require('elliptic');

function State(options) {
  this.visual = new poker.controller.Visual({
    cardCount: options.cardCount
  });
  this.game = new poker.protocol.Protocol({
    index: options.index,
    playerCount: options.playerCount,
    cardCount: options.cardCount,
    curve: elliptic.curves.secp256k1.curve,
    controller: this.visual
  });

  // Protocol events

  this.game.once('ready', function() {
    postMessage({ type: 'ready', payload: null });
  });
  this.game.on('message', function(msg, target) {
    var payload = { message: msg, target: target };
    postMessage({ type: 'message', payload: payload });
  });
  this.game.on('error', function(err) {
    postMessage({ type: 'error', payload: err.message });
  });

  // Controller events

  this.visual.on('update', function(data) {
    postMessage({ type: 'update', payload: data });
  });
}

State.prototype.draw = function draw() {
  this.game.draw(function(err, card) {
    if (err)
      return postMessage({ type: 'error', payload: err.message });
    postMessage({ type: 'draw:complete', payload: card });
  });
};

State.prototype.open = function open(index) {
  this.game.open(index, function(err, card) {
    if (err)
      return postMessage({ type: 'error', payload: err.message });
    postMessage({ type: 'open:complete', payload: card });
  });
};

State.prototype.update = function update(msg) {
  this.game.update(msg, function(err) {
    if (err)
      return postMessage({ type: 'error', payload: err.message });
    postMessage({ type: 'update:complete' });
  });
};

State.prototype.receive = function receive(msg) {
  this.game.receive(msg.data, msg.from);
};

var state = null;

onmessage = function onmessage(e) {
  var msg = e.data;

  if (msg.type === 'init') {
    state = new State(msg.payload);
  } else if (msg.type === 'start') {
    state.game.start();
  } else if (msg.type === 'open') {
    state.open(msg.payload);
  } else if (msg.type === 'draw') {
    state.draw(msg.payload);
  } else if (msg.type === 'update') {
    state.update(msg.payload);
  } else if (msg.type === 'receive') {
    state.receive(msg.payload);
  }
};
