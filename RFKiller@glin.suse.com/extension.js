const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Shell = imports.gi.Shell;
const Urfkill = imports.gi.Urfkill;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Gettext = imports.gettext;
const _ = Gettext.gettext;

const PopupMenu = imports.ui.popupMenu;
const Lightbox = imports.ui.lightbox;
const Tweener = imports.ui.tweener;
const Main = imports.ui.main;

const UrfDeviceType = {
    ALL       : 0,
    WLAN      : 1,
    BLUETOOTH : 2,
    UWB       : 3,
    WIMAX     : 4,
    WWAN      : 5,
    GPS       : 6,
    FM        : 7,
    TOTAL     : 8
};

/* Borrrowed from modalDialog.js */
const OPEN_AND_CLOSE_TIME = 0.1;

const State = {
    OPENED: 0,
    CLOSED: 1,
    OPENING: 2,
    CLOSING: 3,
};

function MyModalDialog() {
    this._init();
}

MyModalDialog.prototype = {
    _init: function() {
        this.state = State.CLOSED;
        this._hasModal = false;

        this._group = new St.Group({ visible: false,
                                     x: 0,
                                     y: 0 });
        Main.uiGroup.add_actor(this._group);

        let constraint = new Clutter.BindConstraint({ source: global.stage,
                                                      coordinate: Clutter.BindCoordinate.POSITION | Clutter.BindCoordinate.SIZE });
        this._group.add_constraint(constraint);

        this._group.connect('destroy', Lang.bind(this, this._onGroupDestroy));
	
        this._group.connect('key-press-event', Lang.bind(this, this._onKeyPressEvent));

        this._lightbox = new Lightbox.Lightbox(this._group,
                                               { inhibitEvents: true });

        this._backgroundBin = new St.Bin();

        this._group.add_actor(this._backgroundBin);
        this._lightbox.highlight(this._backgroundBin);

        this._backgroundStack = new Shell.Stack();
        this._backgroundBin.child = this._backgroundStack;

        this._eventBlocker = new Clutter.Group({ reactive: true });
        this._backgroundStack.add_actor(this._eventBlocker);

        this._dialogLayout = new St.BoxLayout({ style_class: 'rfkiller-dialog',
                                                vertical:    true });
        this._backgroundStack.add_actor(this._dialogLayout);

        this.contentLayout = new St.BoxLayout({ vertical: true });
        this._dialogLayout.add(this.contentLayout,
                               { x_fill:  true,
                                 y_fill:  true,
                                 x_align: St.Align.MIDDLE,
                                 y_align: St.Align.START });

        global.focus_manager.add_group(this._dialogLayout);
        this._initialKeyFocus = this._dialogLayout;
        this._savedKeyFocus = null;
    },

    _onKeyPressEvent: function(object, keyPressEvent) {
        let symbol = keyPressEvent.get_key_symbol();
    },

    _onGroupDestroy: function() {
        this.emit('destroy');
    },

    _fadeOpen: function() {
        let monitor = global.get_focus_monitor();

        this._backgroundBin.set_position(monitor.x, monitor.y);
        this._backgroundBin.set_size(monitor.width, monitor.height);

        this.state = State.OPENING;

        this._dialogLayout.opacity = 255;
        this._lightbox.show();
        this._group.opacity = 0;
        this._group.show();
        Tweener.addTween(this._group,
                         { opacity: 255,
                           time: OPEN_AND_CLOSE_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this,
                               function() {
                                   this.state = State.OPENED;
                                   this.emit('opened');
                               })
                         });
    },

    setInitialKeyFocus: function(actor) {
        this._initialKeyFocus = actor;
    },

    open: function(timestamp) {
        if (this.state == State.OPENED || this.state == State.OPENING)
            return true;

        if (!this.pushModal(timestamp))
            return false;

        this._fadeOpen();
        return true;
    },

    close: function(timestamp) {
        if (this.state == State.CLOSED || this.state == State.CLOSING)
            return;

        this.state = State.CLOSING;
        this.popModal(timestamp);
        this._savedKeyFocus = null;

        Tweener.addTween(this._group,
                         { opacity: 0,
                           time: OPEN_AND_CLOSE_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this,
                               function() {
                                   this.state = State.CLOSED;
                                   this._group.hide();
                               })
                         });
    },

    // Drop modal status without closing the dialog; this makes the
    // dialog insensitive as well, so it needs to be followed shortly
    // by either a close() or a pushModal()
    popModal: function(timestamp) {
        if (!this._hasModal)
            return;

        let focus = global.stage.key_focus;
        if (focus && this._group.contains(focus))
            this._savedKeyFocus = focus;
        else
            this._savedKeyFocus = null;
        Main.popModal(this._group, timestamp);
        global.gdk_screen.get_display().sync();
        this._hasModal = false;

        this._eventBlocker.raise_top();
    },

    pushModal: function (timestamp) {
        if (this._hasModal)
            return true;
        if (!Main.pushModal(this._group, timestamp))
            return false;

        this._hasModal = true;
        if (this._savedKeyFocus) {
            this._savedKeyFocus.grab_key_focus();
            this._savedKeyFocus = null;
        } else
            this._initialKeyFocus.grab_key_focus();

        this._eventBlocker.lower_bottom();
        return true;
    },
};
Signals.addSignalMethods(MyModalDialog.prototype);

function deviceTypeToString (type) {
  switch (type) {
    case UrfDeviceType.ALL:
      return _("ALL");
    case UrfDeviceType.WLAN:
      return _("Wireless");
    case UrfDeviceType.BLUETOOTH:
      return _("Bluetooth");
    case UrfDeviceType.UWB:
      return _("UWB");
    case UrfDeviceType.WIMAX:
      return _("WIMAX");
    case UrfDeviceType.WWAN:
      return _("WWAN");
    case UrfDeviceType.GPS:
      return _("GPS");
    case UrfDeviceType.FM:
      return _("FM");
    default:
      return _("Unknown");
  }
}

function DeviceItem() {
    this._init.apply(this, arguments);
}

DeviceItem.prototype = {
    _init: function (device) {
        this.actor = new St.BoxLayout({ style_class: 'rfkiller-dialog-item',
                                        vertical: false });
        this._label = new St.Label({ text: deviceTypeToString (device.type) });
        this._switch = new St.Bin({ style_class: 'toggle-switch' });
	this.type = device.type;

        // Translators: this MUST be either "toggle-switch-us"
        // (for toggle switches containing the English words
        // "ON" and "OFF") or "toggle-switch-intl" (for toggle
        // switches containing "◯" and "|"). Other values will
        // simply result in invisible toggle switches.
        this._switch.add_style_class_name(_("toggle-switch-us"));
        this.setToggleState(!device.soft);
        this._switch.set_reactive(true);
        this._switch.connect('button-release-event', Lang.bind(this, this._onButtonReleaseEvent));

        this.actor.add (this._label,
                        { expand: true,
                          x_fill: false,
                          y_fill: false,
                          x_align: St.Align.START,
                          y_align: St.Align.MIDDLE });
        this.actor.add (this._switch,
                        { expand: true,
                          x_fill: false,
                          y_fill: false,
                          x_align: St.Align.END,
                          y_align: St.Align.MIDDLE });
    },

    _onButtonReleaseEvent: function (actor, event) {
        this.setToggleState(!this.state);
        this.emit('toggled', this.type, this.state);
        return true;
    },

    setToggleState: function (state) {
        this.state = state;
        if (state)
            this._switch.add_style_pseudo_class('checked');
        else
            this._switch.remove_style_pseudo_class('checked');
    },
};
Signals.addSignalMethods(DeviceItem.prototype);

function RFKillerDialog() {
    this._init();
}

RFKillerDialog.prototype = {
    __proto__: MyModalDialog.prototype,

    _init: function () {
        MyModalDialog.prototype._init.call(this);

        this._buttons = new St.BoxLayout();
        this._deviceItems = [];
        this._toggleID = [];
        this._close = new St.Button({ style_class: 'rfkiller-close' });
        this._buttons.add(this._close,
                        { expand: true,
                          x_fill: false,
                          y_fill: false,
                          x_align: St.Align.END,
                          y_align: St.Align.MIDDLE });

        this._switches = new St.BoxLayout({ vertical: true });

        this._close.connect ('clicked', Lang.bind(this, this.close));

        this.connect('key-press-event', Lang.bind(this, this._onKeyPressEvent));
        this.contentLayout.add(this._buttons,
                               { expand:  true,
                                 x_align: St.Align.MIDDLE,
                                 y_align: St.Align.START});

        this.contentLayout.add(this._switches,
                               { expand: true,
                                 x_align: St.Align.MIDDLE,
                                 y_align: St.Align.START });
    },

    _onKeyPressEvent: function(actor, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Escape) {
            this.close();
            return true;
        }
        return false;
    },

    _onSwitchToggled: function (object, type, state) {
        this.emit ('switch-toggled', type, state);
    },

    addDeviceItem: function (device) {
        let deviceItem = new DeviceItem (device);
        this._switches.add (deviceItem.actor,
                            { expand: true,
                              x_fill: true,
                              y_fill: false,
                              x_align: St.Align.START,
                              y_align: St.Align.MIDDLE });
        this._deviceItems[device.type] = deviceItem;
        this._toggleID[device.type] = deviceItem.connect('toggled',
			                                 Lang.bind(this, this._onSwitchToggled));
    },

    removeDeviceItem: function (type) {
        if (this._deviceItems[type] != null) {
            this._switches.remove (this._deviceItems[type]);
            this._deviceItems[type].disconnect (this._toggleID[type]);
            this._deviceItems[type] = null;
            this._toggleID[type] = null;
        }
    },

    updateDeviceItem: function (device) {
        let type = device.type;
        if (this._deviceItems[type] != null) {
            this._deviceItems[type].setToggleState (!device.soft);
        }
    },

    open: function() {
        MyModalDialog.prototype.open.call(this);
    },
};
Signals.addSignalMethods(RFKillerDialog.prototype);

function RFKillerController() {
    this._init();
}

RFKillerController.prototype = {
    _init: function () {
        this._urfClient = new Urfkill.Client ();
        this._devices = this._urfClient.get_devices ();
        this._dialog = new RFKillerDialog ();
        this.pivots = [];

        for (let i = 0; i < this._devices.length; i++) {
            let device = this._devices[i];
            if (this.pivots[device.type] == null || this.is_platform_driver (device.name))
                this.pivots[device.type] = device;
        }
        for (let i = 0; i < UrfDeviceType.TOTAL; i++) {
            if (this.pivots[i] != null)
                this._dialog.addDeviceItem (this.pivots[i]);
        }

        this._cookie = this._urfClient.inhibit ("RFKiller is running", null);

        /* Connect signals */
        this._urfClient.connect ('device-added', Lang.bind(this, this.deviceAdded));
        this._urfClient.connect ('device-removed', Lang.bind(this, this.deviceRemoved));
        this._urfClient.connect ('device-changed', Lang.bind(this, this.deviceChanged));
        this._urfClient.connect ('rf-key-pressed', Lang.bind(this, this.rfKeyPressed));
        this._dialog.connect ('switch-toggled', Lang.bind(this, this.toggleSwitch));
    },

    assign_new_pivot: function (type) {
        this.pivots[type] = null;

        for (let i = 0; i < this._devices.length; i++) {
            let device = this._devices[i];
            if (device.type != type)
                continue;

            if (this.pivots[device.type] == null || this.is_platform_driver (device.name))
                this.pivots[device.type] = device;
        }
    },

    deviceAdded: function (client, device) {
        if (this.pivots[device.type] == null || this.is_platform_driver (device.name)) {
            this.pivots[device.type] = device;
	    this._dialog.addDeviceItem (device);
        }
    },

    deviceRemoved: function (client, device) {
        let type = device.type;
        if (this.pivots[type] == device) {
            assign_new_pivot(type);
	    if (this.pivots[type] == null)
                this._dialog.removeDeviceItem (type);
	    else
                this._dialog.updateDeviceItem (this.pivots[type]);
        }
    },

    deviceChanged: function (client, device) {
        if (this.pivots[device.type] == device) {
            this._dialog.updateDeviceItem (device);
        }
    },

    is_platform_driver: function (name) {
        /* The vendor names which are generated by platform drivers */
        let vendors = [
            "acer", /* acer-wmi */
            "asus", /* asus-laptop */
            "cmpc", /* classmate-laptop */
            "compal", /* compal-laptop */
            "dell", /* dell-laptop */
            "eeepc", /* eeepc-laptop, eeepc-wmi */
            "hp", /* hp-wmi */
            "ideapad", /* ideapad-laptop */
            "msi", /* msi-laptop */
            "sony", /* sony-laptop */
            "tpacpi", /* thinkpad_acpi */
            "Toshiba", /* toshiba_acpi */
        ];

        for (let i = 0; i < vendors.length; i++) {
            if (GLib.str_has_prefix (name, vendors[i]))
	        return true;
        }

        return false;
    },

    rfKeyPressed: function (client, keycode) {
        for (let i = 0; i < UrfDeviceType.TOTAL; i++) {
            if (this.pivots[i] != null) {
                this._dialog.open();
                break;
            }
        }
    },

    toggleSwitch: function (object, type, state) {
        if (type < UrfDeviceType.TOTAL && type > 0) {
            this._urfClient.set_block (type, !state, null, null);
        }
    },
}

function main(extensionMeta) {
    let userExtensionLocalePath = extensionMeta.path + '/locale';
    Gettext.bindtextdomain("RFKiller", userExtensionLocalePath);
    Gettext.textdomain("RFKiller");

    let controller = new RFKillerController();
}
