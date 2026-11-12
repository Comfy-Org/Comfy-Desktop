export const MCP_NUDGE_ELEMENT_ID = 'comfy-desktop-mcp-nudge'
export const MCP_NUDGE_DISMISSED_KEY = 'comfyDesktopMcpNudgeDismissed'

const MCP_NUDGE_MAIN_JS = `
var NUDGE_ID = ${JSON.stringify(MCP_NUDGE_ELEMENT_ID)};
var DISMISSED_KEY = ${JSON.stringify(MCP_NUDGE_DISMISSED_KEY)};
var bridge = window.__comfyDesktop2;

function track(name, props) {
  try {
    bridge.Telemetry.capture('comfy.desktop.mcp.' + name, props || {});
  } catch (e) {}
}

function isDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function hide() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch (e) {}
  var existing = document.getElementById(NUDGE_ID);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

function buildNudge() {
  var nudge = document.createElement('div');
  nudge.id = NUDGE_ID;
  nudge.setAttribute('role', 'status');
  nudge.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483646;' +
    'display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);' +
    'padding:10px 10px 10px 16px;border-radius:12px;' +
    'background:var(--comfy-menu-bg, #171717);color:var(--fg-color, #e5e5e5);' +
    'border:1px solid var(--border-color, rgba(255,255,255,0.1));' +
    'box-shadow:0 12px 32px rgba(0,0,0,0.35);' +
    'font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.35;' +
    'opacity:0;transform:translateY(8px);' +
    'transition:opacity 200ms ease-out,transform 200ms ease-out;';

  var text = document.createElement('div');
  text.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';
  var title = document.createElement('span');
  title.style.cssText = 'font-weight:600;';
  title.textContent = 'Run this build from your AI agent';
  var lead = document.createElement('span');
  lead.style.cssText = 'opacity:0.65;';
  lead.textContent = 'Connect Claude Code, Cursor or any MCP agent.';
  text.appendChild(title);
  text.appendChild(lead);

  var connect = document.createElement('button');
  connect.type = 'button';
  connect.setAttribute('data-testid', 'mcp-nudge-connect');
  connect.textContent = 'Connect';
  connect.style.cssText =
    'flex:none;cursor:pointer;border:0;border-radius:8px;height:32px;padding:0 14px;' +
    'font:inherit;font-weight:600;' +
    'background:var(--fg-color, #e5e5e5);color:var(--comfy-menu-bg, #171717);' +
    'transition:opacity 120ms ease-out;';
  connect.addEventListener('mouseenter', function () { connect.style.opacity = '0.88'; });
  connect.addEventListener('mouseleave', function () { connect.style.opacity = '1'; });
  connect.addEventListener('click', function () {
    track('panel_opened', { entrypoint: 'nudge' });
    hide();
    try {
      var result = bridge.openMcpSetup();
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (e) {}
  });

  var close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.setAttribute('data-testid', 'mcp-nudge-dismiss');
  close.textContent = '\\u00d7';
  close.style.cssText =
    'flex:none;cursor:pointer;border:0;border-radius:6px;width:28px;height:28px;' +
    'background:transparent;color:currentColor;font-size:16px;line-height:1;opacity:0.55;' +
    'transition:opacity 120ms ease-out;';
  close.addEventListener('mouseenter', function () { close.style.opacity = '0.9'; });
  close.addEventListener('mouseleave', function () { close.style.opacity = '0.55'; });
  close.addEventListener('click', function () {
    track('nudge_dismissed', {});
    hide();
  });

  nudge.appendChild(text);
  nudge.appendChild(connect);
  nudge.appendChild(close);
  return nudge;
}

function showNudge() {
  if (isDismissed() || document.getElementById(NUDGE_ID) || !document.body) return;
  var nudge = buildNudge();
  document.body.appendChild(nudge);
  requestAnimationFrame(function () {
    nudge.style.opacity = '1';
    nudge.style.transform = 'translateY(0)';
  });
  track('nudge_shown', {});
}

showNudge();
`

let cachedScript: string | null = null

export function getMcpNudgeContentScript(): string {
  if (cachedScript) return cachedScript
  cachedScript =
    `(function () {\n` +
    `'use strict';\n` +
    `if (typeof window === 'undefined' || !window.__comfyDesktop2) return;\n` +
    `if (typeof window.__comfyDesktop2.openMcpSetup !== 'function') return;\n` +
    `if (window.__comfyDesktopMcpNudge) return;\n` +
    `window.__comfyDesktopMcpNudge = true;\n` +
    MCP_NUDGE_MAIN_JS +
    `})();\n`
  return cachedScript
}
