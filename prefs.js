import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WhoisThatPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(600, 560);
        window.set_title(_('WhoisThat Settings'));

        const page = new Adw.PreferencesPage();
        window.add(page);

        // 1. Positioning Section
        const posGroup = new Adw.PreferencesGroup({
            title: _('Positioning'),
            description: _('Configure where the indicator appears on the top bar'),
        });
        page.add(posGroup);

        const boxModel = Gtk.StringList.new([
            _('Right'),
            _('Center'),
            _('Left')
        ]);
        const boxValues = ['right', 'center', 'left'];

        const boxRow = new Adw.ComboRow({
            title: _('Panel Position'),
            subtitle: _('Which section of the top bar to display the indicator in'),
            model: boxModel,
        });

        const currentBox = settings.get_string('panel-box');
        const boxIdx = boxValues.indexOf(currentBox);
        boxRow.set_selected(boxIdx >= 0 ? boxIdx : 0);

        boxRow.connect('notify::selected', () => {
            const selectedIdx = boxRow.get_selected();
            if (selectedIdx >= 0 && selectedIdx < boxValues.length) {
                settings.set_string('panel-box', boxValues[selectedIdx]);
            }
        });
        posGroup.add(boxRow);

        const orderRow = new Adw.SpinRow({
            title: _('Order Index'),
            subtitle: _('Offset / order within the chosen section (0 = edge)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 50,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('panel-position'),
            }),
        });
        settings.bind('panel-position', orderRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(orderRow);

        // 2. Appearance Section
        const appGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Customize what information is shown in the top bar'),
        });
        page.add(appGroup);

        const dotRow = new Adw.SwitchRow({
            title: _('Show Status Dot'),
            subtitle: _('Display the colored marker (●) reflecting connection status'),
        });
        settings.bind('show-status-dot', dotRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appGroup.add(dotRow);

        const statusTextRow = new Adw.SwitchRow({
            title: _('Show Status Text'),
            subtitle: _('Display text label ([Connected], [Disconnected], [Offline])'),
        });
        settings.bind('show-status-text', statusTextRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appGroup.add(statusTextRow);

        const modeRow = new Adw.SwitchRow({
            title: _('Show Mode Badge'),
            subtitle: _('Display whether VPN is in [TUN] or [Proxy] mode'),
        });
        settings.bind('show-mode-badge', modeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appGroup.add(modeRow);

        const speedRow = new Adw.SwitchRow({
            title: _('Show Network Speed'),
            subtitle: _('Display real-time download and upload speeds'),
        });
        settings.bind('show-speed', speedRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appGroup.add(speedRow);

        // 3. Terminal & TUI Section
        const termGroup = new Adw.PreferencesGroup({
            title: _('Terminal & TUI'),
            description: _('Configure the terminal emulator used for Open WhoisThat TUI'),
        });
        page.add(termGroup);

        const termModel = Gtk.StringList.new([
            _('Auto-detect (System default)'),
            'Alacritty',
            'GNOME Terminal',
            'Ptyxis',
            'Kitty',
            'Ghostty',
            'XTerm'
        ]);
        const termValues = ['auto', 'alacritty', 'gnome-terminal', 'ptyxis', 'kitty', 'ghostty', 'xterm'];

        const termRow = new Adw.ComboRow({
            title: _('Terminal Emulator'),
            subtitle: _('Select which terminal to launch for WhoisThat TUI'),
            model: termModel,
        });

        const currentTerm = settings.get_string('terminal-command');
        const termIdx = termValues.indexOf(currentTerm);
        termRow.set_selected(termIdx >= 0 ? termIdx : 0);

        termRow.connect('notify::selected', () => {
            const selectedIdx = termRow.get_selected();
            if (selectedIdx >= 0 && selectedIdx < termValues.length) {
                settings.set_string('terminal-command', termValues[selectedIdx]);
            }
        });
        termGroup.add(termRow);
    }
}
