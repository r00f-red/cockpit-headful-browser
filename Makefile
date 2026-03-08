# Headful Browser Cockpit Plugin Makefile

PACKAGE_NAME := headful-browser
RPM_NAME := cockpit-$(PACKAGE_NAME)
VERSION := $(shell git describe 2>/dev/null || echo 1.0)
PREFIX ?= /usr/local
COCKPIT_DIR := $(PREFIX)/share/cockpit
INSTALL_DIR := $(PREFIX)/lib/$(PACKAGE_NAME)
SERVICE_DIR := /etc/systemd/system

.PHONY: all install clean devel-install devel-uninstall

all:
	@echo "Headful Browser - Cockpit Plugin"
	@echo ""
	@echo "Targets:"
	@echo "  make build         - Build the plugin"
	@echo "  make install       - Install to $(PREFIX)"
	@echo "  make devel-install - Symlink for development"
	@echo "  make clean         - Remove build artifacts"

build: node_modules
	./build.js

node_modules: package.json
	npm install
	@touch node_modules

install: build
	install -d $(DESTDIR)$(COCKPIT_DIR)/$(PACKAGE_NAME)
	cp -r dist/* $(DESTDIR)$(COCKPIT_DIR)/$(PACKAGE_NAME)/

	install -d $(DESTDIR)$(INSTALL_DIR)
	install -m 755 service/headful-browser.sh $(DESTDIR)$(INSTALL_DIR)/

	install -d $(DESTDIR)$(SERVICE_DIR)
	install -m 644 service/headful-browser.service $(DESTDIR)$(SERVICE_DIR)/

	@echo "Installed. Run: sudo systemctl daemon-reload"

devel-install: node_modules
	mkdir -p ~/.local/share/cockpit
	ln -sf $(PWD) ~/.local/share/cockpit/$(PACKAGE_NAME)
	./build.js
	@echo "Development install done. Edit files and run ./build.js to rebuild"

devel-uninstall:
	rm -f ~/.local/share/cockpit/$(PACKAGE_NAME)

clean:
	rm -rf dist/ node_modules/

watch: node_modules
	./build.js -w
