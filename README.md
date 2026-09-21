# WhoisThat GNOME Shell Extension

Top bar indicator and quick control menu for the **WhoisThat** VPN client.

## Features

- **Top Bar Indicator**:
  - Colored status dot (`●` green — connected, gray — disconnected, red — core offline).
  - Active mode badge (`[TUN]` / `[Proxy]`).
  - Real-time network speed monitor (`↓ rx_speed ↑ tx_speed`).
- **Dropdown Menu**:
  - Active profile name and protocol.
  - One-click **Connect / Disconnect** toggle.
  - Quick **TUN Mode** switch (system VPN / proxy).
  - Nested **Profiles** list grouped by subscription with active profile checkmark.
  - **Open WhoisThat TUI** button to launch full interface in a terminal.
- **Reliability**:
  - Asynchronous NDJSON stream reading (`whoisthat status --watch --json`) without blocking GNOME Shell.
  - Automatic reconnection when WhoisThat daemon restarts.

## Compatibility

- **GNOME Shell**: 45, 46, 47, 48, 49, 50+
- **WhoisThat**: 0.9.x+

## Installation & Management

Using `make`:

```bash
# Install to ~/.local/share/gnome-shell/extensions/
make install

# Enable extension
make enable

# Build .zip package for extensions.gnome.org
make pack

# Disable extension
make disable

# View extension logs in real-time
make logs
```

After the initial installation on a **Wayland** session, log out and log back in to allow GNOME Shell to discover the new extension folder. On **X11**, you can restart GNOME Shell via `Alt + F2` -> `r` -> `Enter`.
