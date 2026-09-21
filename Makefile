UUID = whoisthat-indicator@kvunoff
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC_DIR = $(shell pwd)

.PHONY: all install install-link enable disable pack uninstall logs

all: install

install:
	@echo "Installing $(UUID) to $(INSTALL_DIR)..."
	@mkdir -p $(INSTALL_DIR)
	@cp -f metadata.json stylesheet.css extension.js $(INSTALL_DIR)/
	@echo "Installed. Run 'make enable' or restart GNOME Shell."

install-link:
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

pack:
	@echo "Packaging extension..."
	@gnome-extensions pack --force --extra-source=stylesheet.css
	@echo "Created $(UUID).shell-extension.zip"

uninstall: disable
	@echo "Removing $(INSTALL_DIR)..."
	@rm -rf $(INSTALL_DIR)
	@echo "Uninstalled."

logs:
	@journalctl -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered whoisthat
