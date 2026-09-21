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
    _init(settings) {
        super._init(0.0, 'WhoisThat Indicator');

        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._watchProcess = null;
        this._reconnectTimeoutId = null;
        this._syncingTunToggle = false;
        this._settingsSignals = [];

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
        this._bindSettings();
        this._startWatcher();
    }

    _bindSettings() {
        if (!this._settings) return;

        const updateKeys = ['show-status-dot', 'show-status-text', 'show-mode-badge', 'show-speed'];
        for (const key of updateKeys) {
            const sid = this._settings.connect(`changed::${key}`, () => {
                this._updateUi();
            });
            this._settingsSignals.push(sid);
        }
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
        const showDot = this._settings ? this._settings.get_boolean('show-status-dot') : true;
        const showStatusText = this._settings ? this._settings.get_boolean('show-status-text') : true;
        const showModeBadge = this._settings ? this._settings.get_boolean('show-mode-badge') : true;
        const showSpeed = this._settings ? this._settings.get_boolean('show-speed') : true;

        // Fallback: at least one element must be visible so indicator is clickable
        const forceDot = !showDot && !showStatusText && !showModeBadge && !showSpeed;
        this._dot.visible = showDot || forceDot;

        if (!this._state.core_running) {
            this._dot.style_class = 'whoisthat-status-dot whoisthat-status-offline';
            this._label.text = '[Offline]';
            this._label.visible = showStatusText;
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

        const modeTag = this._state.tun_enabled ? 'TUN' : 'Proxy';

        if (this._state.connected) {
            this._dot.style_class = 'whoisthat-status-dot whoisthat-status-connected';

            const parts = [];
            if (showStatusText) parts.push('[Connected]');
            if (showModeBadge) parts.push(`[${modeTag}]`);
            if (showSpeed) {
                const rx = this._state.rx_speed_human || '0 B/s';
                const tx = this._state.tx_speed_human || '0 B/s';
                parts.push(`↓ ${rx} ↑ ${tx}`);
            }

            this._label.text = parts.join(' ');
            this._label.visible = parts.length > 0;

            const name = this._state.profile_name || 'Connected';
            const proto = this._state.protocol ? ` (${this._state.protocol})` : '';
            this._menuHeader.label.text = `${name}${proto} — ${modeTag}`;
            this._connectToggleItem.label.text = 'Disconnect';
        } else {
            this._dot.style_class = 'whoisthat-status-dot whoisthat-status-disconnected';
            this._label.text = '[Disconnected]';
            this._label.visible = showStatusText;
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
        const preferred = this._settings ? this._settings.get_string('terminal-command') : 'auto';

        if (preferred && preferred !== 'auto' && GLib.find_program_in_path(preferred)) {
            const flag = preferred === 'gnome-terminal' || preferred === 'ptyxis' ? '--' : '-e';
            try {
                const proc = new Gio.Subprocess({
                    argv: [preferred, flag, 'whoisthat'],
                    flags: Gio.SubprocessFlags.NONE
                });
                proc.init(null);
                return;
            } catch (_) {}
        }

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
        if (this._settings && this._settingsSignals) {
            for (const sid of this._settingsSignals) {
                this._settings.disconnect(sid);
            }
            this._settingsSignals = [];
        }

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
        this._settings = this.getSettings();
        this._settingsSignals = [];

        const onPositionChanged = () => {
            this._reposition();
        };

        this._settingsSignals.push(
            this._settings.connect('changed::panel-box', onPositionChanged),
            this._settings.connect('changed::panel-position', onPositionChanged)
        );

        this._setupIndicator();
    }

    _setupIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        const box = this._settings.get_string('panel-box') || 'right';
        const pos = this._settings.get_int('panel-position') || 0;

        this._indicator = new WhoisThatIndicator(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator, pos, box);
    }

    _reposition() {
        this._setupIndicator();
    }

    disable() {
        if (this._settings && this._settingsSignals) {
            for (const id of this._settingsSignals) {
                this._settings.disconnect(id);
            }
            this._settingsSignals = [];
        }
        this._settings = null;

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
