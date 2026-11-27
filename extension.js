import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const OFFLINE_STATE = {
    core_running: false,
    connected: false,
    tun_enabled: false,
    profile_name: null,
    protocol: null,
};

const CORE_REPO_URL = 'https://github.com/kvunoff/whoisthat';

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

        this._state = { ...OFFLINE_STATE, binary_installed: true };
        this._actionPending = false;
        this._profileRequest = null;
        this._profileItems = new Map();
        this._activeProfileItem = null;

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
        this._updateUi();
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

        // 2. Install guidance item (shown only when whoisthat is missing)
        this._installItem = new PopupMenu.PopupMenuItem('Install WhoisThat CLI...');
        this._installItem.connect('activate', () => {
            Gio.AppInfo.launch_default_for_uri(CORE_REPO_URL, null);
        });
        this.menu.addMenuItem(this._installItem);
        this._installItem.visible = false;

        this._separator1 = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._separator1);

        // 3. Connect / Disconnect button
        this._connectToggleItem = new PopupMenu.PopupMenuItem('Connect');
        this._connectToggleItem.connect('activate', () => {
            this._runCmd([this._state.connected ? 'disconnect' : 'connect', '--wait']);
        });
        this.menu.addMenuItem(this._connectToggleItem);

        // 4. TUN Mode switch
        this._tunToggleItem = new PopupMenu.PopupSwitchMenuItem('TUN Mode', false);
        this._tunToggleItem.connect('toggled', (_item, state) => {
            if (this._syncingTunToggle) return;
            if (state !== this._state.tun_enabled) {
                this._runCmd(['mode', state ? 'tun' : 'proxy']);
            }
        });
        this.menu.addMenuItem(this._tunToggleItem);

        // 5. Profiles list submenu
        this._profilesSubmenu = new PopupMenu.PopupSubMenuMenuItem('Profiles');
        this.menu.addMenuItem(this._profilesSubmenu);

        // Refresh profiles whenever the menu is opened
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen && this._state.core_running) {
                this._refreshProfilesMenu();
            }
        });

        this._separator2 = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._separator2);

        // 6. Open full TUI interface
        this._openTuiItem = new PopupMenu.PopupMenuItem('Open WhoisThat TUI');
        this._openTuiItem.connect('activate', () => {
            this._launchTerminal();
        });
        this.menu.addMenuItem(this._openTuiItem);
    }

    _updateUi() {
        const showDot = this._settings ? this._settings.get_boolean('show-status-dot') : true;
        const showStatusText = this._settings ? this._settings.get_boolean('show-status-text') : true;
        const showModeBadge = this._settings ? this._settings.get_boolean('show-mode-badge') : true;
        const showSpeed = this._settings ? this._settings.get_boolean('show-speed') : true;

        const connected = this._state.core_running && this._state.connected;
        this._dot.visible = showDot || !(showStatusText || (connected && (showModeBadge || showSpeed)));

        // State A: WhoisThat binary is not installed
        if (!this._state.binary_installed) {
            this._dot.style_class = 'whoisthat-status-dot whoisthat-status-offline';
            this._label.text = '[Not Installed]';
            this._label.visible = showStatusText;
            this._menuHeader.label.text = 'WhoisThat is not installed';
            this._installItem.visible = true;
            this._separator1.visible = true;
            this._connectToggleItem.visible = false;
            this._tunToggleItem.visible = false;
            this._profilesSubmenu.visible = false;
            this._separator2.visible = false;
            this._openTuiItem.visible = false;
            return;
        }

        // State B: Binary is installed, but core daemon is not running
        this._installItem.visible = false;
        this._connectToggleItem.visible = true;
        this._tunToggleItem.visible = true;
        this._profilesSubmenu.visible = true;
        this._separator2.visible = true;
        this._openTuiItem.visible = true;

        const controlsReady = !this._actionPending;
        this._connectToggleItem.setSensitive(controlsReady);
        this._tunToggleItem.setSensitive(controlsReady && this._state.core_running);
        this._profilesSubmenu.setSensitive(controlsReady && this._state.core_running);

        this._syncingTunToggle = true;
        this._tunToggleItem.setToggleState(this._state.tun_enabled);
        this._syncingTunToggle = false;
        this._updateActiveProfile();

        if (!this._state.core_running) {
            this._dot.style_class = 'whoisthat-status-dot whoisthat-status-offline';
            this._label.text = '[Offline]';
            this._label.visible = showStatusText;
            this._menuHeader.label.text = 'WhoisThat: Core is offline';
            this._connectToggleItem.label.text = 'Connect';
            return;
        }

        // State C: Core daemon is online

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
        if (!GLib.find_program_in_path('whoisthat')) {
            this._state.binary_installed = false;
            this._state.core_running = false;
            this._updateUi();
            this._scheduleReconnect(30);
            return;
        }

        this._state.binary_installed = true;

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
                if (this._cancellable.is_cancelled())
                    return;
                if (line !== null) {
                    const wasOnline = this._state.core_running;
                    const status = JSON.parse(line);
                    this._state = { ...OFFLINE_STATE, ...status, binary_installed: true };
                    this._updateUi();
                    if (!wasOnline && status.core_running && this.menu.isOpen)
                        this._refreshProfilesMenu();
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
        this._watchProcess?.force_exit();
        this._watchProcess = null;
        this._state = { ...OFFLINE_STATE, binary_installed: this._state.binary_installed };
        this._profileRequest = null;
        this._profilesSubmenu.menu.removeAll();
        this._profileItems.clear();
        this._activeProfileItem = null;
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

    _runCmd(args) {
        if (this._actionPending)
            return;

        const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE;
        try {
            const process = Gio.Subprocess.new(['whoisthat', ...args, '--json'], flags);
            this._actionPending = true;
            this._updateUi();

            process.communicate_utf8_async(null, this._cancellable, (child, result) => {
                try {
                    const [, stdout] = child.communicate_utf8_finish(result);
                    if (this._cancellable.is_cancelled())
                        return;
                    if (!child.get_successful()) {
                        const detail = child.get_if_exited()
                            ? `Exit code: ${child.get_exit_status()}`
                            : `Signal: ${child.get_term_sig()}`;
                        throw new Error(detail);
                    }
                    if (args[0] === 'mode' && this._state.core_running)
                        this._state.tun_enabled = JSON.parse(stdout).result.tun_enabled;
                } catch (error) {
                    if (!this._cancellable.is_cancelled())
                        Main.notifyError('WhoisThat command failed', error.message);
                } finally {
                    if (!this._cancellable.is_cancelled()) {
                        this._actionPending = false;
                        this._updateUi();
                    }
                }
            });
        } catch (error) {
            Main.notifyError('Could not start WhoisThat', error.message);
            this._actionPending = false;
            this._updateUi();
        }
    }

    _refreshProfilesMenu() {
        if (!this._state.core_running || this._profileRequest)
            return;

        const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE;
        try {
            const process = Gio.Subprocess.new(['whoisthat', 'profile', 'list', '--json'], flags);
            this._profileRequest = process;
            process.communicate_utf8_async(null, this._cancellable, (child, result) => {
                try {
                    const [, stdout] = child.communicate_utf8_finish(result);
                    if (process !== this._profileRequest || this._cancellable.is_cancelled())
                        return;
                    if (!child.get_successful())
                        throw new Error('profile list exited unsuccessfully');
                    this._populateProfiles(JSON.parse(stdout));
                } catch (error) {
                    if (process === this._profileRequest && !this._cancellable.is_cancelled())
                        this._showProfilesUnavailable(error);
                } finally {
                    if (process === this._profileRequest)
                        this._profileRequest = null;
                }
            });
        } catch (error) {
            this._profileRequest = null;
            this._showProfilesUnavailable(error);
        }
    }

    _populateProfiles(profiles) {
        const groups = new Map();
        for (const profile of profiles) {
            if (!groups.has(profile.group_id))
                groups.set(profile.group_id, []);
            groups.get(profile.group_id).push(profile);
        }

        this._profilesSubmenu.menu.removeAll();
        this._profileItems.clear();
        this._activeProfileItem = null;
        if (groups.size === 0)
            this._profilesSubmenu.menu.addMenuItem(
                new PopupMenu.PopupMenuItem('No profiles', { reactive: false }));

        for (const group of groups.values()) {
            const header = new PopupMenu.PopupMenuItem(`Group: ${group[0].group_name}`, { reactive: false });
            header.label.style = 'font-weight: bold; font-size: 11px; color: #7dcfff;';
            this._profilesSubmenu.menu.addMenuItem(header);

            for (const profile of group) {
                const selector = `${profile.group_id}:${profile.id}`;
                const item = new PopupMenu.PopupMenuItem(`${profile.name} (${profile.protocol})`);
                item.connect('activate', () => this._runCmd(['connect', selector, '--wait']));
                this._profilesSubmenu.menu.addMenuItem(item);
                this._profileItems.set(selector, item);
            }
        }
        this._updateActiveProfile();
    }

    _showProfilesUnavailable(error) {
        console.error('WhoisThat: could not list profiles:', error);
        this._profilesSubmenu.menu.removeAll();
        this._profileItems.clear();
        this._activeProfileItem = null;
        this._profilesSubmenu.menu.addMenuItem(
            new PopupMenu.PopupMenuItem('Could not load profiles', { reactive: false }));
    }

    _updateActiveProfile() {
        const { connected, group_id, profile_id } = this._state;
        const item = connected ? this._profileItems.get(`${group_id}:${profile_id}`) : null;
        if (item === this._activeProfileItem)
            return;
        this._activeProfileItem?.setOrnament(PopupMenu.Ornament.NONE);
        item?.setOrnament(PopupMenu.Ornament.DOT);
        this._activeProfileItem = item;
    }

    _launchTerminal() {
        const preferred = this._settings.get_string('terminal-command');
        const terminalFlags = {
            alacritty: ['-e'],
            'gnome-terminal': ['--'],
            ptyxis: ['--'],
            kitty: [],
            ghostty: ['-e'],
            xterm: ['-e'],
        };
        const argv = Object.hasOwn(terminalFlags, preferred) && GLib.find_program_in_path(preferred)
            ? [preferred, ...terminalFlags[preferred], 'whoisthat']
            : ['whoisthat'];

        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE);
        } catch (error) {
            Main.notifyError('Could not open WhoisThat', error.message);
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
        this._watchProcess?.force_exit();
        this._watchProcess = null;
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
