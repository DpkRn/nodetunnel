.PHONY: pkg test help

help:
	@echo "Available commands:"
	@echo "  make pkg      - Publish package to npm"
	@echo "  make test     - Run tests"

pkg:
	@echo "Publishing to npm..."
	npm login
	npm version patch
	npm publish --access public

test:
	@echo "Running tests..."
	npm run test-lib
