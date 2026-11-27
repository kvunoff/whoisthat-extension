# WhoisThat GNOME Shell Extension

Top bar indicator and quick control menu for the **[WhoisThat](https://github.com/kvunoff/whoisthat)** VPN client.

> **Note**: This extension is a companion interface designed specifically for the [WhoisThat VPN client](https://github.com/kvunoff/whoisthat). Make sure `whoisthat` is installed on your system to enable live connection status, speed monitoring, and quick controls.

## Features

- **Top Bar Indicator**:
  - Colored status dot (`●` green — connected, gray — disconnected, red — core offline / not installed).
  - Active mode badge (`[TUN]` / `[Proxy]`).
  - Real-time network speed monitor (`↓ rx_speed ↑ tx_speed`).
- **Dropdown Menu**:
  - Active profile name and protocol.
  - One-click **Connect / Disconnect** toggle.
  - Quick **TUN Mode** switch (system VPN / proxy).
  - Nested **Profiles** list grouped by subscription with active profile checkmark.
  - **Open WhoisThat TUI** button to launch full interface in a terminal.
  - Direct installation link if `whoisthat` is missing.
- **Preferences & Customization**:
  - **Positioning**: choose top bar panel section (Right, Center, Left) and position order index with immediate on-the-fly relocation.
  - **Appearance**: toggle visibility for status dot (`●`), status text (`[Connected]`), mode badge (`[TUN]`/`[Proxy]`), and live speed.
  - **Terminal**: select preferred terminal emulator for launching TUI (Auto-detect, Alacritty, GNOME Terminal, Ptyxis, Kitty, Ghostty, XTerm).
- **Reliability**:
  - Asynchronous NDJSON stream reading (`whoisthat status --watch --json`) without blocking GNOME Shell.
  - Automatic reconnection when the WhoisThat daemon restarts.
  - **Connect** can start the core through the CLI, even when the indicator shows **Offline**.

The profile menu uses `whoisthat profile list --json`. The TUN switch runs
`whoisthat mode tun` or `whoisthat mode proxy`. With the terminal preference set
to **Auto-detect**, **Open WhoisThat TUI** uses the terminal configured by WhoisThat.

## Requirements

- **GNOME Shell**: 45–51
- **WhoisThat VPN Client**: [github.com/kvunoff/whoisthat](https://github.com/kvunoff/whoisthat) (v0.19.7+)

## Installation & Management

Using `make`:

```bash
# Install to ~/.local/share/gnome-shell/extensions/
make install

# Enable extension
make enable

# Open preferences window (customization)
make prefs

# Build .zip package for extensions.gnome.org
make pack

# Disable extension
make disable

# View extension logs in real-time
make logs
```

After the initial installation on a **Wayland** session, log out and log back in to allow GNOME Shell to discover the new extension folder. On **X11**, you can restart GNOME Shell via `Alt + F2` -> `r` -> `Enter`.
