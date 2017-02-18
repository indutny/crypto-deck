'use strict';

exports.RNG = require('./crypto-deck/rng');
exports.Shuffle = require('./crypto-deck/shuffle');
exports.Deck = require('./crypto-deck/deck');
exports.MessageStream = require('./crypto-deck/message-stream');

exports.protocol = {};
exports.protocol.Base = require('./crypto-deck/protocol/base');
exports.protocol.Protocol = require('./crypto-deck/protocol/protocol');

// Shortcut
exports.Protocol = exports.protocol.Protocol;
exports.create = function create(options) {
  return new exports.Protocol(options);
};
