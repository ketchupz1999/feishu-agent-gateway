.PHONY: install build test pack
install:
	npm ci
build:
	npm run build
test:
	npm test
pack:
	mkdir -p releases
	npm pack --pack-destination releases
