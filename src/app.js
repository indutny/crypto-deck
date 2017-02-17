'use strict';

var io = require('socket.io-client')();

var hash = document.location.hash.slice(1);
if (!hash) {
  hash = Math.floor(Math.random() * 0xffffffff).toString(36);
  hash += Math.floor(Math.random() * 0xffffffff).toString(36);
  document.location.hash = '#' + hash;
}

var elems = {
  board: document.getElementById('board'),
  deck: document.getElementById('deck'),
  players: []
};
var l = document.getElementsByClassName('player');
for (var i = 0; i < l.length; i++)
  elems.players.push(l[i]);
elems.players.sort(function(a, b) {
  var ai = a.dataset.index | 0;
  var bi = b.dataset.index | 0;
  return ai - bi;
});

function Card() {
  this.owner = null;
  this.value = null;

  this.elem = document.createElement('article');
  this.elem.classList.add('card');

  var self = this;
  this.update({ owner: null, value: null });
}

Card.prototype.update = function update(data) {
  this.owner = data.owner;
  this.value = data.value;

  var classList = this.elem.classList;
  if (this.owner === null && this.value === null) {
    classList.add('card-deck');
    elems.deck.appendChild(this.elem);
  } else if (this.owner === null) {
    classList.remove('card-deck');
    classList.remove('card-player');
    classList.add('card-board');
    elems.board.appendChild(this.elem);
  } else {
    classList.remove('card-deck');
    classList.remove('card-board');
    classList.add('card-player');
    elems.players[this.owner].appendChild(this.elem);
  }
  this.elem.dataset.value = this.value;
};

function Game(id) {
  this.id = id;

  // Join room
  io.emit('join', hash);

  this.players = [];
  this.index = null;
  this.cards = new Array(36);
  for (var i = 0; i < this.cards.length; i++)
    this.cards[i] = new Card();
  this.started = false;
  this.worker = new Worker('/js/worker.js');

  this.handleIO();
  this.handleWorker();
  this.handleUI();
}

Game.prototype.handleIO = function handleIO() {
  var self = this;
  var worker = this.worker;
  io.on('join', function(p) {
    if (p.id === io.id)
      self.index = p.index;
    self.players[p.index] = p.id;
  });

  io.on('leave', function(p) {
    if (self.started) {
      document.location.hash = '';
      return document.location.reload();
    }
    self.players[p.index] = null;
  });

  io.once('start', function() {
    self.started = true;
    worker.postMessage({
      type: 'init',
      payload: {
        cardCount: self.cards.length,
        index: self.index,
        playerCount: self.players.length
      }
    });
    worker.postMessage({ type: 'start' });
  });

  io.on('message', function(msg) {
    worker.postMessage({ type: 'receive', payload: msg });
  });
};

Game.prototype.handleWorker = function handleWorker() {
  var self = this;
  this.worker.onmessage = function(e) {
    var msg = e.data;
    if (msg.type === 'error') {
      console.error(msg.payload);
    } else if (msg.type === 'ready') {
      self.onReady();
    } else if (msg.type === 'update') {
      self.onUpdate(msg.payload);
    } else if (msg.type === 'message') {
      io.emit('message', {
        data: msg.payload.message,
        target: msg.payload.target
      });
    } else if (msg.type === 'visual') {
      io.emit('message', {
        data: msg.payload.message,
        target: msg.payload.target
      });
    } else if (msg.type === 'draw:complete') {
      elems.deck.disabled = false;
    }
  }
};

Game.prototype.handleUI = function handleUI() {
  var self = this;
  elems.deck.onclick = function(e) {
    e.preventDefault();
    elems.deck.disabled = true;
    self.worker.postMessage({ type: 'draw' });
  };
};

Game.prototype.onReady = function onReady() {
  console.log('ready');

  document.getElementById('loading').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
};

Game.prototype.onUpdate = function onUpdate(data) {
  this.cards[data.index].update(data.card);
};

var g = new Game(hash);
