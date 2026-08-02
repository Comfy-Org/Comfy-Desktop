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

function startTabPopoutInjector() {
  if (STATE.tabBarInjectorStarted) return;
  STATE.tabBarInjectorStarted = true;

  function containsLeafText(root, target) {
    if (!root || !root.querySelectorAll) return false;
    var leaves = root.querySelectorAll('*');
    var pattern = new RegExp('^' + target + '$', 'i');
    for (var i = 0; i < leaves.length; i++) {
      var element = leaves[i];
      if (!element || element.children.length > 0) continue;
      if (pattern.test((element.textContent || '').trim())) return true;
    }
    return false;
  }

  function findBottomPanelHeader() {
    var closes = document.querySelectorAll(
      'button[aria-label="Close"], [role="button"][aria-label="Close"], button[title="Close"]'
    );
    for (var i = 0; i < closes.length; i++) {
      var close = closes[i];
      if (!close) continue;
      var testid = (close.getAttribute && close.getAttribute('data-testid')) || '';
      if (/minimap/i.test(testid)) continue;
      var ancestor = close.parentElement;
      for (var depth = 0; depth < 6 && ancestor; depth++) {
        if (containsLeafText(ancestor, 'Terminal') && containsLeafText(ancestor, 'Logs')) {
          return ancestor;
        }
        ancestor = ancestor.parentElement;
      }
    }
    return null;
  }

  function findTabButton(header, label) {
    var leaves = header.querySelectorAll('*');
    var pattern = new RegExp('^' + label + '$', 'i');
    for (var i = 0; i < leaves.length; i++) {
      var leaf = leaves[i];
      if (!leaf || leaf.children.length > 0) continue;
      if (!pattern.test((leaf.textContent || '').trim())) continue;
      var current = leaf;
      for (var depth = 0; depth < 6 && current && current.parentElement; depth++) {
        var parent = current.parentElement;
        if (parent === header) break;
        var role = parent.getAttribute && parent.getAttribute('role');
        var tag = (parent.tagName || '').toLowerCase();
        var classes = parent.className || '';
        if (role === 'tab' || tag === 'button' || tag === 'a' || /tab/i.test(String(classes))) {
          return parent;
        }
        current = parent;
      }
      return leaf.parentElement || leaf;
    }
    return null;
  }

  function makePopoutButton(kind) {
    var button = document.createElement('button');
    button.className = '__comfy-desktop-popout-btn';
    button.setAttribute('data-popout-kind', kind);
    button.type = 'button';
    var label = kind === 'terminal'
      ? 'Open terminal in a new window'
      : 'Open logs in a new window';
    button.title = 'Open in a new window';
    button.setAttribute('aria-label', label);
    button.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;' +
      'width:18px;height:18px;margin-left:6px;padding:0;border:0;' +
      'background:transparent;color:currentColor;cursor:pointer;' +
      'opacity:0.55;border-radius:4px;transition:opacity 120ms ease, background 120ms ease;' +
      'vertical-align:middle;';
    button.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14 3h7v7"/><path d="M21 3l-9 9"/>' +
      '<path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>' +
      '</svg>';
    button.addEventListener('mouseenter', function () {
      button.style.opacity = '1';
      button.style.background = 'rgba(255,255,255,0.08)';
    });
    button.addEventListener('mouseleave', function () {
      button.style.opacity = '0.55';
      button.style.background = 'transparent';
    });
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var bridge = window.__comfyDesktop2;
      var target = kind === 'terminal' ? bridge.Terminal : bridge.Logs;
      try {
        if (target && typeof target.openPopout === 'function') target.openPopout();
      } catch (error) {}
    });
    return button;
  }

  function injectButton(header, label, kind) {
    var tab = findTabButton(header, label);
    if (!tab) return;
    var selector = '.__comfy-desktop-popout-btn[data-popout-kind="' + kind + '"]';
    if (!tab.querySelector(selector)) tab.appendChild(makePopoutButton(kind));
  }

  function injectButtons() {
    var header = findBottomPanelHeader();
    if (!header) return;
    injectButton(header, 'Terminal', 'terminal');
    injectButton(header, 'Logs', 'logs');
  }

  injectButtons();
  var settleTries = 0;
  var settleInterval = setInterval(function () {
    settleTries++;
    injectButtons();
    if (settleTries > 50) clearInterval(settleInterval);
  }, 200);
  var observer = new MutationObserver(injectButtons);
  observer.observe(document.body, { childList: true, subtree: true });
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

startTabPopoutInjector();
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
