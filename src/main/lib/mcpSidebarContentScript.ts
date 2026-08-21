let cachedScript: string | null = null

/** localStorage key for the one-time "unseen" dot on the sidebar plug icon.
 *  Cleared the first time the user opens the MCP surface. */
const SEEN_KEY = 'comfyDesktopMcpSeen'

const MCP_SIDEBAR_MAIN_JS = `
var STATE = window.__comfyDesktopMcpSidebar;
var SEEN_KEY = ${JSON.stringify(SEEN_KEY)};
var TAB_ID = 'comfy-desktop-mcp';

function track(name, props) {
  try {
    window.__comfyDesktop2.Telemetry.capture('comfy.desktop.mcp.' + name, props || {});
  } catch (e) {}
}

function isSeen() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch (e) {}
}

function openSetup(app) {
  markSeen();
  STATE.unseen = false;
  track('sidebar_opened', {});
  try {
    var result = window.__comfyDesktop2.openMcpSetup();
    if (result && typeof result.catch === 'function') result.catch(function () {});
  } catch (e) {}
  // The MCP experience is a desktop overlay, not an in-page sidebar panel.
  // Toggle our own tab back off so the icon behaves as a plain button and
  // the empty phantom panel never lingers.
  try {
    var mgr = app.extensionManager;
    var store = (mgr && mgr.sidebarTab) || mgr;
    if (store && typeof store.toggleSidebarTab === 'function') {
      store.toggleSidebarTab(TAB_ID);
    }
  } catch (e) {}
}

function alreadyRegistered(app) {
  try {
    var tabs = app.extensionManager.getSidebarTabs() || [];
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i] && tabs[i].id === TAB_ID) return true;
    }
  } catch (e) {}
  return false;
}

function register(app) {
  if (alreadyRegistered(app)) {
    STATE.registered = true;
    return;
  }
  STATE.unseen = !isSeen();
  try {
    app.extensionManager.registerSidebarTab({
      id: TAB_ID,
      title: 'Connect an agent (MCP)',
      tooltip: 'Connect an agent (MCP)',
      icon: 'icon-[lucide--plug]',
      type: 'custom',
      iconBadge: function () {
        return STATE.unseen ? '\\u2022' : null;
      },
      render: function () {
        // Fire immediately on select; the panel body stays empty because the
        // real UI is the desktop overlay modal.
        openSetup(app);
      },
      destroy: function () {}
    });
    STATE.registered = true;
  } catch (e) {}
}

function waitForRegister(timeoutMs) {
  var startedAt = Date.now();
  (function tick() {
    if (STATE.registered) return;
    var app = window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app;
    var mgr = app && app.extensionManager;
    if (mgr && typeof mgr.registerSidebarTab === 'function') {
      register(app);
      return;
    }
    if (Date.now() > startedAt + timeoutMs) return;
    setTimeout(tick, 100);
  })();
}

waitForRegister(30000);
`

export function getMcpSidebarContentScript(): string {
  if (cachedScript) return cachedScript
  cachedScript =
    `(function () {\n` +
    `'use strict';\n` +
    `if (typeof window === 'undefined' || !window.__comfyDesktop2) return;\n` +
    `if (typeof window.__comfyDesktop2.openMcpSetup !== 'function') return;\n` +
    `if (window.__comfyDesktopMcpSidebar) return;\n` +
    `window.__comfyDesktopMcpSidebar = { registered: false, unseen: false };\n` +
    MCP_SIDEBAR_MAIN_JS +
    `})();\n`
  return cachedScript
}
