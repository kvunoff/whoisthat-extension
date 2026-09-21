UUID = whoisthat-indicator@kvunoff
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC_DIR = $(shell pwd)

.PHONY: all schemas install install-link enable disable pack prefs uninstall logs

all: schemas install

schemas:
	@echo "Compiling GSettings schemas..."
	@glib-compile-schemas schemas/

install: schemas
	@echo "Installing $(UUID) to $(INSTALL_DIR)..."
	@mkdir -p $(INSTALL_DIR)/schemas
	@cp -f metadata.json stylesheet.css extension.js prefs.js README.md LICENSE $(INSTALL_DIR)/
	@cp -f schemas/* $(INSTALL_DIR)/schemas/
	@echo "Installed successfully. Use 'make prefs' to open settings."

install-link: schemas
	@echo "Symlinking $(SRC_DIR) -> $(INSTALL_DIR)..."
	@mkdir -p $(dir $(INSTALL_DIR))
	@rm -rf $(INSTALL_DIR)
	@ln -s $(SRC_DIR) $(INSTALL_DIR)
	@echo "Symlinked for development."

enable:
	@gnome-extensions enable $(UUID)
	@echo "Extension $(UUID) enabled."

disable:
	@gnome-extensions disable $(UUID)
	@echo "Extension $(UUID) disabled."

prefs:
	@gnome-extensions prefs $(UUID)

pack: schemas
	@echo "Packaging extension..."
	@gnome-extensions pack --force \
		--extra-source=stylesheet.css \
		--extra-source=prefs.js \
		--extra-source=schemas \
		--extra-source=README.md \
		--extra-source=LICENSE
	@echo "Created $(UUID).shell-extension.zip"

uninstall: disable
	@echo "Removing $(INSTALL_DIR)..."
	@rm -rf $(INSTALL_DIR)
	@echo "Uninstalled."

logs:
	@journalctl -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered whoisthat
