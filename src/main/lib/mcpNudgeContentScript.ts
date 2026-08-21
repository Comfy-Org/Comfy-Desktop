let cachedScript: string | null = null

/** Comfy brand hex, inlined because the hosted ComfyUI frontend page does
 *  not expose the desktop renderer's brand tokens — only `--fg-color` and
 *  `--comfy-menu-bg`, which we read as fallbacks where they help. */
const COMFY_YELLOW = '#f2ff59'
const COMFY_INK = '#211927'

const MCP_NUDGE_MAIN_JS = `
var COMFY_YELLOW = ${JSON.stringify(COMFY_YELLOW)};
var COMFY_INK = ${JSON.stringify(COMFY_INK)};

function track(name, props) {
  try {
    window.__comfyDesktop2.Telemetry.capture('comfy.desktop.mcp.' + name, props || {});
  } catch (e) {}
}

function openModal() {
  // The rich, branded setup experience (left video / right UX) lives in the
  // trusted desktop renderer where the brand design system is available.
  // The banner only opens it.
  try {
    var result = window.__comfyDesktop2.openMcpSetup();
    if (result && typeof result.catch === 'function') result.catch(function () {});
  } catch (e) {}
}

function isDismissed() {
  try {
    // TODO(mcp-nudge): dismiss-once is intentionally disabled for now — the
    // banner re-shows on every canvas load until we set a stop condition.
    // Restore \`window.localStorage.getItem('comfyDesktopMcpNudgeDismissed') === '1'\`.
    return false;
  } catch (e) {
    return false;
  }
}

function dismiss() {
  var existing = document.getElementById('comfy-desktop-mcp-nudge');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

function buildNudge() {
  var nudge = document.createElement('div');
  nudge.id = 'comfy-desktop-mcp-nudge';
  nudge.style.cssText =
    'position:fixed;right:18px;bottom:18px;z-index:2147483646;' +
    'display:inline-flex;align-items:center;gap:14px;width:max-content;max-width:calc(100vw - 36px);' +
    'padding:12px 14px 12px 16px;border-radius:12px;' +
    'background:' + COMFY_INK + ';color:#f0efed;' +
    'border:1px solid rgba(255,255,255,0.08);' +
    'box-shadow:0 16px 40px rgba(0,0,0,0.5);' +
    "font-family:'PP Formula','Inter',system-ui,sans-serif;" +
    'font-size:13px;line-height:1.35;white-space:nowrap;' +
    'opacity:0;transform:translateY(6px);' +
    'transition:opacity 220ms ease,transform 220ms ease;';

  var dot = document.createElement('span');
  dot.style.cssText =
    'flex:none;width:6px;height:6px;border-radius:9999px;' +
    'background:' + COMFY_YELLOW + ';box-shadow:0 0 6px rgba(242,255,89,0.6);';

  var text = document.createElement('div');
  text.style.cssText = 'flex:none;';
  text.innerHTML =
    '<span style="font-weight:600;">Comfy has an MCP.</span>' +
    '<span style="opacity:0.6;margin-left:6px;">Connect your agent.</span>';

  var connect = document.createElement('button');
  connect.type = 'button';
  connect.textContent = 'CONNECT';
  connect.style.cssText =
    'cursor:pointer;border:0;border-radius:8px;flex:none;' +
    'padding:8px 22px;font-size:11.5px;font-weight:600;' +
    'letter-spacing:0.08em;text-transform:uppercase;' +
    'background:' + COMFY_YELLOW + ';color:' + COMFY_INK + ';' +
    'box-shadow:0 2px 10px rgba(242,255,89,0.28);' +
    'transition:opacity 140ms ease,box-shadow 140ms ease;';
  connect.addEventListener('mouseenter', function () { connect.style.opacity = '0.9'; });
  connect.addEventListener('mouseleave', function () { connect.style.opacity = '1'; });
  connect.addEventListener('click', function () {
    track('panel_opened', { entrypoint: 'nudge' });
    openModal();
    dismiss();
  });

  var close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '\\u00d7';
  close.style.cssText =
    'cursor:pointer;border:0;background:transparent;color:currentColor;flex:none;' +
    'font-size:15px;line-height:1;opacity:0.45;padding:0 2px;align-self:flex-start;';
  close.addEventListener('mouseenter', function () { close.style.opacity = '0.85'; });
  close.addEventListener('mouseleave', function () { close.style.opacity = '0.5'; });
  close.addEventListener('click', function () {
    track('panel_dismissed', { stage: 'nudge' });
    dismiss();
  });

  nudge.appendChild(dot);
  nudge.appendChild(text);
  nudge.appendChild(connect);
  nudge.appendChild(close);
  return nudge;
}

function showNudge() {
  if (isDismissed()) return;
  if (document.getElementById('comfy-desktop-mcp-nudge')) return;
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
