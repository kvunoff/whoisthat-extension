import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const WhoisThatIndicator = GObject.registerClass(
class WhoisThatIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'WhoisThat Indicator');

        this._cancellable = new Gio.Cancellable();
        this._watchProcess = null;
        this._reconnectTimeoutId = null;
        this._syncingTunToggle = false;

        this._state = {
            core_running: false,
            connected: false,
            tun_enabled: false,
            mode: '',
            profile_name: null,
            protocol: null,
            rx_speed_human: '0 B/s',
            tx_speed_human: '0 B/s'
        };

        // Container in panel
        const box = new St.BoxLayout({ style_class: 'whoisthat-panel-box' });

        this._dot = new St.Label({
            text: '●',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'whoisthat-status-dot whoisthat-status-offline'
        });
        box.add_child(this._dot);

        this._label = new St.Label({
            text: '[Offline]',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'whoisthat-panel-text'
        });
        box.add_child(this._label);

        this.add_child(box);

        this._buildMenu();
        this._startWatcher();
    }

    _buildMenu() {
        this.menu.removeAll();

        // 1. Status header
        this._menuHeader = new PopupMenu.PopupMenuItem('WhoisThat: Offline', { reactive: false });
        this.menu.addMenuItem(this._menuHeader);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 2. Connect / Disconnect button (toggle via -t)
        this._connectToggleItem = new PopupMenu.PopupMenuItem('Connect');
        this._connectToggleItem.connect('activate', () => {
            this._runCmd(['whoisthat', '-t']);
        });
        this.menu.addMenuItem(this._connectToggleItem);

        // 3. TUN Mode switch (toggle via -mt)
        this._tunToggleItem = new PopupMenu.PopupSwitchMenuItem('TUN Mode', false);
        this._tunToggleItem.connect('toggled', (_item, state) => {
            if (this._syncingTunToggle) return;
            if (state !== this._state.tun_enabled) {
                this._runCmd(['whoisthat', '-mt']);
            }
        });
        this.menu.addMenuItem(this._tunToggleItem);

        // 4. Profiles list submenu
        this._profilesSubmenu = new PopupMenu.PopupSubMenuMenuItem('Profiles');
        this.menu.addMenuItem(this._profilesSubmenu);
        this._refreshProfilesMenu();

        // Refresh profiles whenever the menu is opened
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen && this._state.core_running) {
                this._refreshProfilesMenu();
            }
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 5. Open full TUI interface
        const openTuiItem = new PopupMenu.PopupMenuItem('Open WhoisThat TUI');
        openTuiItem.connect('activate', () => {
            this._launchTerminal();
        });
        this.menu.addMenuItem(openTuiItem);
    }

    _updateUi() {
        if (!this._state.core_running) {
            this._dot.style_class = 'whoisthat-status-dot whoisthat-status-offline';
            this._label.text = '[Offline]';
            this._menuHeader.label.text = 'WhoisThat: Core is offline';
            this._connectToggleItem.label.text = 'Connect';
            this._connectToggleItem.setSensitive(false);
            this._tunToggleItem.setSensitive(false);
            return;
        }

        this._connectToggleItem.setSensitive(true);
        this._tunToggleItem.setSensitive(true);

        this._syncingTunToggle = true;
        this._tunToggleItem.setToggleState(!!this._state.tun_enabled);
        this._syncingTunToggle = false;

        if (this._state.connected) {
            this._dot.style_class = 'whoisthat-status-dot whoisthat-status-connected';
            const modeTag = this._state.tun_enabled ? 'TUN' : 'Proxy';
            const rx = this._state.rx_speed_human || '0 B/s';
            const tx = this._state.tx_speed_human || '0 B/s';
            this._label.text = `[Connected] [${modeTag}] ↓ ${rx} ↑ ${tx}`;

            const name = this._state.profile_name || 'Connected';
            const proto = this._state.protocol ? ` (${this._state.protocol})` : '';
            this._menuHeader.label.text = `${name}${proto} — ${modeTag}`;
            this._connectToggleItem.label.text = 'Disconnect';
        } else {
            this._dot.style_class = 'whoisthat-status-dot whoisthat-status-disconnected';
            this._label.text = '[Disconnected]';
            this._menuHeader.label.text = 'WhoisThat: Disconnected';
            this._connectToggleItem.label.text = 'Connect';
        }
    }

    _startWatcher() {
        try {
            this._watchProcess = new Gio.Subprocess({
                argv: ['whoisthat', 'status', '--watch', '--json'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            });

            this._watchProcess.init(this._cancellable);

            const stdoutPipe = this._watchProcess.get_stdout_pipe();
            const dataStream = new Gio.DataInputStream({ base_stream: stdoutPipe });

            this._readNextLine(dataStream);
        } catch (e) {
            this._state.core_running = false;
            this._updateUi();
            this._scheduleReconnect(5);
        }
    }

    _readNextLine(dataStream) {
        dataStream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (stream, res) => {
            try {
                const [line] = stream.read_line_finish_utf8(res);
                if (line !== null) {
                    const parsed = JSON.parse(line);
                    this._state = Object.assign(this._state, parsed);
                    this._updateUi();
                    this._readNextLine(dataStream);
                } else {
                    this._handleProcessExit();
                }
            } catch (err) {
                if (!this._cancellable.is_cancelled()) {
                    this._handleProcessExit();
                }
            }
        });
    }

    _handleProcessExit() {
        this._state.core_running = false;
        this._updateUi();
        this._scheduleReconnect(3);
    }

    _scheduleReconnect(seconds = 3) {
        if (this._reconnectTimeoutId) {
            GLib.source_remove(this._reconnectTimeoutId);
            this._reconnectTimeoutId = null;
        }
        this._reconnectTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._reconnectTimeoutId = null;
            if (!this._cancellable.is_cancelled()) {
                this._startWatcher();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _runCmd(argv) {
        try {
            const proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.NONE
            });
            proc.init(null);
        } catch (e) {
            console.error(`WhoisThat: error running command ${argv.join(' ')}: ${e}`);
        }
    }

    _refreshProfilesMenu() {
        try {
            const proc = new Gio.Subprocess({
                argv: ['whoisthat', 'profiles', '--json'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            });
            proc.init(this._cancellable);
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (!stdout) return;
                    const groups = JSON.parse(stdout);
                    this._profilesSubmenu.menu.removeAll();

                    for (const g of groups) {
                        const groupSection = new PopupMenu.PopupMenuItem(`Group: ${g.group.name}`, { reactive: false });
                        groupSection.label.style = 'font-weight: bold; font-size: 11px; color: #7dcfff;';
                        this._profilesSubmenu.menu.addMenuItem(groupSection);

                        for (const prof of g.profiles) {
                            const isCurrent = this._state.profile_name === prof.name && this._state.connected;
                            const prefix = isCurrent ? '● ' : '  ';
                            const item = new PopupMenu.PopupMenuItem(`${prefix}${prof.name} (${prof.protocol})`);
                            item.connect('activate', () => {
                                this._runCmd(['whoisthat', 'connect', `${g.group.id}:${prof.id}`]);
                            });
                            this._profilesSubmenu.menu.addMenuItem(item);
                        }
                    }
                } catch (_) {}
            });
        } catch (_) {}
    }

    _launchTerminal() {
        const terminals = [
            ['xdg-terminal-exec', 'whoisthat'],
            ['alacritty', '-e', 'whoisthat'],
            ['gnome-terminal', '--', 'whoisthat'],
            ['ptyxis', '--', 'whoisthat'],
            ['kitty', 'whoisthat'],
            ['ghostty', '-e', 'whoisthat'],
            ['xterm', '-e', 'whoisthat']
        ];

        for (const argv of terminals) {
            const bin = argv[0];
            if (GLib.find_program_in_path(bin)) {
                try {
                    const proc = new Gio.Subprocess({ argv: argv, flags: Gio.SubprocessFlags.NONE });
                    proc.init(null);
                    return;
                } catch (e) {
                    console.error(`WhoisThat: failed launching ${bin}: ${e}`);
                }
            }
        }
    }

    destroy() {
        if (this._reconnectTimeoutId) {
            GLib.source_remove(this._reconnectTimeoutId);
            this._reconnectTimeoutId = null;
        }
        this._cancellable.cancel();
        if (this._watchProcess) {
            try {
                this._watchProcess.force_exit();
            } catch (_) {}
            this._watchProcess = null;
        }
        super.destroy();
    }
});

export default class WhoisThatExtension extends Extension {
    enable() {
        this._indicator = new WhoisThatIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
