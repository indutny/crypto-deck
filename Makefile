BROWSERIFY ?= ./node_modules/.bin/browserify

all: public/js/bundle.js public/js/worker.js

public/js/bundle.js: src/app.js
	$(BROWSERIFY) $< -o $@

public/js/worker.js: src/worker.js
	$(BROWSERIFY) $< -o $@

.PHONY: all
