let cachedScript: string | null = null

/** localStorage key for the one-time "unseen" dot on the sidebar plug icon.
 *  Cleared the first time the user opens the MCP surface. */
const SEEN_KEY = 'comfyDesktopMcpSeen'

const MCP_SIDEBAR_MAIN_JS = `
var STATE = window.__comfyDesktopMcpSidebar;
var SEEN_KEY = ${JSON.stringify(SEEN_KEY)};
var BTN_ID = 'comfy-desktop-mcp-btn';

function track(name, props) {
  try {
    window.__comfyDesktop2.Telemetry.capture('comfy.desktop.mcp.' + name, props || {});
  } catch (e) {}
}

function isSeen() {
  try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
}
function markSeen() {
  try { window.localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
}

function openSetup() {
  markSeen();
  hideDot();
  track('sidebar_opened', {});
  try {
    var result = window.__comfyDesktop2.openMcpSetup();
    if (result && typeof result.catch === 'function') result.catch(function () {});
  } catch (e) {}
}

function hideDot() {
  var dot = document.querySelector('#' + BTN_ID + ' .comfy-mcp-dot');
  if (dot) dot.style.display = 'none';
}

function buildButton() {
  var btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.className = 'side-bar-button comfy-mcp-btn';
  btn.setAttribute('aria-label', 'Connect an agent (MCP)');
  btn.title = 'Connect an agent (MCP)';
  // .side-bar-button is scoped, so mirror SidebarIcon.vue's chrome inline.
  btn.style.cssText =
    'display:flex;align-items:center;justify-content:center;overflow:visible;' +
    'width:var(--sidebar-width);height:var(--sidebar-item-height);' +
    'border:none;border-radius:0;flex-shrink:0;cursor:pointer;background:transparent;' +
    'color:var(--content-fg,#9b9b9b);transition:background-color 120ms ease,color 120ms ease;';
  btn.addEventListener('mouseenter', function () {
    btn.style.backgroundColor = 'var(--interface-panel-hover-surface)';
    btn.style.color = 'var(--content-hover-fg)';
  });
  btn.addEventListener('mouseleave', function () {
    btn.style.backgroundColor = 'transparent';
    btn.style.color = 'var(--content-fg,#9b9b9b)';
  });

  var content = document.createElement('div');
  content.className = 'side-bar-button-content flex flex-col items-center gap-2';

  var wrap = document.createElement('div');
  wrap.className = 'sidebar-icon-wrapper relative';
  wrap.style.cssText = 'position:relative;overflow:visible;';

  var icon = document.createElement('i');
  icon.className = 'icon-[lucide--plug] side-bar-button-icon';
  icon.style.fontSize = 'var(--sidebar-icon-size)';

  var dot = document.createElement('span');
  dot.className = 'comfy-mcp-dot';
  dot.style.cssText =
    'position:absolute;top:-3px;right:-8px;width:8px;height:8px;border-radius:9999px;' +
    'background:#2f80ff;pointer-events:none;';
  dot.style.display = isSeen() ? 'none' : 'block';

  wrap.appendChild(icon);
  wrap.appendChild(dot);
  content.appendChild(wrap);
  btn.appendChild(content);
  btn.addEventListener('click', openSetup);
  return btn;
}

function bottomCluster() {
  // Anchor off the help button so we don't guess the .mt-auto group's classes.
  var help = document.querySelector('[data-testid="help-center-button"]');
  if (help) {
    var group = help.closest('.mt-auto') || help.parentElement;
    if (group) return { group: group, before: help };
  }
  var toolbar = document.querySelector('[data-testid="side-toolbar"]');
  if (toolbar) {
    var mt = toolbar.querySelector('.mt-auto');
    if (mt) return { group: mt, before: mt.firstChild };
  }
  return null;
}

function inject() {
  if (document.getElementById(BTN_ID)) return true;
  var target = bottomCluster();
  if (!target) return false;
  target.group.insertBefore(buildButton(), target.before);
  return true;
}

// Toolbar re-renders drop the button, so restore it via observer + settle loop.
function start() {
  if (STATE.started) return;
  STATE.started = true;

  var injected = inject();
  var tries = 0;
  var settle = setInterval(function () {
    tries++;
    if (inject() || tries > 100) clearInterval(settle);
  }, 200);

  STATE.observer = new MutationObserver(function () {
    if (!document.getElementById(BTN_ID)) inject();
  });
  try {
    STATE.observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
  return injected;
}

start();
`

export function getMcpSidebarContentScript(): string {
  if (cachedScript) return cachedScript
  cachedScript =
    `(function () {\n` +
    `'use strict';\n` +
    `if (typeof window === 'undefined' || !window.__comfyDesktop2) return;\n` +
    `if (typeof window.__comfyDesktop2.openMcpSetup !== 'function') return;\n` +
    `if (window.__comfyDesktopMcpSidebar) return;\n` +
    `window.__comfyDesktopMcpSidebar = { started: false };\n` +
    MCP_SIDEBAR_MAIN_JS +
    `})();\n`
  return cachedScript
}
