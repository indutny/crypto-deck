# Crypto Deck
[![Build Status](https://secure.travis-ci.org/indutny/crypto-deck.png)](http://travis-ci.org/indutny/crypto-deck)
[![NPM version](https://badge.fury.io/js/crypto-deck.svg)](http://badge.fury.io/js/crypto-deck)

Cryptographically secure [Mental Card Deck][0] implementation.

## Usage

```js
const cryptoDeck = require('crypto-deck');

// Put some game rules here:
// - `validate` MUST throw on violation of rules, and it MUST not modify
//    internal state of controller
// - other methods are allowed to modify state, but MUST not throw
//
const controller = {
  validateDraw: (playerIndex, cardIndex) => {},
  draw: (playerIndex, cardIndex, cardValue) => {},
  validateOpen: (playerIndex, cardIndex) => {},
  open: (playerIndex, cardIndex, cardValue) => {},
  validateUpdate: (state) => {},
  update: (state) => {},
};

const p = new cryptoDeck.protocol.Protocol({
  curve: require('elliptic').curves.secp256k1.curve,
  cardCount: 54,
  controller,
  playerCount: 4,
  index: 0  /* Put player index here, should be less than `playerCount`
});

p.on('message', (message, target) => {
  // If `target` is `undefined` - this method MUST broadcast the message to all
  // other players.
  //
  // Otherwise this method MUST send the message to player specified by
  // numeric index `target`
});

// On incoming message `p.receive()` MUST be called. `from` is a numeric index
// again.
p.receive(message, from);

//
// Card APIs
//

p.draw(function(err, card) {
  console.log(card);  // { index: ..., value: ... }
});

p.open(index /* or `null` */, function(err, card) {
  console.log(card);  // { index: ..., value: ... }
});

// Anything unrelated to the drawing/opening of the cards MAY happen using
// `update` method and by specifying `update` behavior in controller.
p.update(state, function(err) {
});
```

## LICENSE

This software is licensed under the MIT License.

Copyright Fedor Indutny, 2017.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.

[0]: http://www.clee.kr/thesis.pdf
