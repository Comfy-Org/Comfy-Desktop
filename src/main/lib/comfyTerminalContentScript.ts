let cachedScript: string | null = null

const TERMINAL_TAB_MAIN_JS = `
var STATE = window.__comfyDesktopTerminalStopgap;

function openDesktopTerminal() {
  try {
    var result = window.__comfyDesktop2.openTerminal();
    if (result && typeof result.catch === 'function') result.catch(function () {});
  } catch (e) {}
}

function renderTerminal(container) {
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.height = '100%';

  var content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.alignItems = 'center';
  content.style.gap = '12px';
  content.style.color = 'var(--fg-color, #e5e5e5)';

  var message = document.createElement('div');
  message.textContent = 'Terminal commands run in a protected Desktop window.';

  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open Desktop Terminal';
  button.style.cssText = 'cursor:pointer;border:0;border-radius:6px;padding:8px 14px;background:#3b82f6;color:#fff;';
  button.addEventListener('click', openDesktopTerminal);

  content.appendChild(message);
  content.appendChild(button);
  container.appendChild(content);
  openDesktopTerminal();
}

function bottomPanelHasTab(app, id) {
  try {
    var bottomPanel = app && app.extensionManager && app.extensionManager.bottomPanel;
    var terminalPanel = bottomPanel && bottomPanel.panels && bottomPanel.panels.terminal;
    var tabs = terminalPanel && terminalPanel.tabs;
    if (!tabs) return false;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i] && tabs[i].id === id) return true;
    }
  } catch (e) {}
  return false;
}

function alreadyHasTerminalTab(app) {
  if (bottomPanelHasTab(app, 'command-terminal')) return true;
  try {
    var extensions = (app && app.extensions) || [];
    for (var i = 0; i < extensions.length; i++) {
      var extension = extensions[i] || {};
      if (extension.name === 'Comfy.Desktop.TerminalStopgap') continue;
      var tabs = extension.bottomPanelTabs || [];
      for (var j = 0; j < tabs.length; j++) {
        if (tabs[j] && tabs[j].id === 'command-terminal') return true;
      }
    }
  } catch (e) {}
  return false;
}

function waitForRegister(timeoutMs) {
  var startedAt = Date.now();
  (function tick() {
    if (STATE.registered) return;
    var app = window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app;
    var register = app && app.registerExtension;
    if (typeof register === 'function') {
      if (alreadyHasTerminalTab(app)) {
        STATE.registered = true;
        return;
      }
      if (!bottomPanelHasTab(app, 'logs-terminal') && Date.now() - startedAt <= timeoutMs) {
        setTimeout(tick, 100);
        return;
      }
      try {
        register.call(app, {
          name: 'Comfy.Desktop.TerminalStopgap',
          bottomPanelTabs: [{
            id: 'command-terminal',
            title: 'Terminal',
            type: 'custom',
            render: renderTerminal,
            destroy: function () {}
          }]
        });
        STATE.registered = true;
      } catch (e) {}
      return;
    }
    if (Date.now() > startedAt + timeoutMs) return;
    setTimeout(tick, 100);
  })();
}

waitForRegister(30000);
`

export function getComfyTerminalContentScript(): string {
  if (cachedScript) return cachedScript
  cachedScript =
    `(function () {\n` +
    `'use strict';\n` +
    `if (typeof window === 'undefined' || !window.__comfyDesktop2 || typeof window.__comfyDesktop2.openTerminal !== 'function') return;\n` +
    `if (window.__comfyDesktopTerminalStopgap) return;\n` +
    `window.__comfyDesktopTerminalStopgap = { registered: false };\n` +
    TERMINAL_TAB_MAIN_JS +
    `})();\n`
  return cachedScript
}
