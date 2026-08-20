let cachedScript: string | null = null

const DOCS_MCP_LOCAL = 'https://docs.comfy.org/agent-tools/mcp#local-comfy-mcp-connection'
const AGENT_INSTALL_LINKS = [
  { label: 'Claude Code', href: 'https://docs.anthropic.com/en/docs/claude-code/setup' },
  { label: 'Cursor', href: 'https://docs.cursor.com/get-started/installation' },
  { label: 'Codex', href: 'https://developers.openai.com/codex/cli' }
]

const CONNECT_SNIPPETS = [
  { client: 'claude_code', label: 'Claude Code', value: 'claude mcp add comfy-mcp -- comfy-mcp' },
  {
    client: 'json',
    label: 'Cursor / Claude Desktop (JSON)',
    value: '{ "mcpServers": { "comfy-mcp": { "command": "comfy-mcp" } } }'
  }
]

const DISMISS_KEY = 'comfyDesktopMcpNudgeDismissed'

const MCP_NUDGE_MAIN_JS = `
var SNIPPETS = ${JSON.stringify(CONNECT_SNIPPETS)};
var AGENT_LINKS = ${JSON.stringify(AGENT_INSTALL_LINKS)};
var DOCS_LOCAL = ${JSON.stringify(DOCS_MCP_LOCAL)};
var DISMISS_KEY = ${JSON.stringify(DISMISS_KEY)};

function track(name, props) {
  try {
    window.__comfyDesktop2.Telemetry.capture('comfy.desktop.mcp.' + name, props || {});
  } catch (e) {}
}

function openTerminal() {
  try {
    var result = window.__comfyDesktop2.openTerminal();
    if (result && typeof result.catch === 'function') result.catch(function () {});
  } catch (e) {}
}

function isDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch (e) {}
}

function copyText(value) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      var p = navigator.clipboard.writeText(value);
      if (p && typeof p.catch === 'function') p.catch(function () {});
      return;
    }
  } catch (e) {}
  try {
    var area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  } catch (e) {}
}

function styleButton(button, primary) {
  button.style.cssText =
    'cursor:pointer;border:0;border-radius:6px;padding:7px 12px;font-size:13px;' +
    (primary
      ? 'background:#3b82f6;color:#fff;'
      : 'background:rgba(127,127,127,0.16);color:var(--fg-color,#e5e5e5);');
}

function makeSnippetRow(snippet) {
  var row = document.createElement('div');
  row.style.cssText =
    'display:flex;align-items:center;gap:8px;margin-top:8px;width:100%;';

  var label = document.createElement('div');
  label.textContent = snippet.label;
  label.style.cssText = 'font-size:12px;opacity:0.7;min-width:150px;';

  var code = document.createElement('code');
  code.textContent = snippet.value;
  code.style.cssText =
    'flex:1;font-size:12px;background:rgba(0,0,0,0.28);border-radius:5px;' +
    'padding:6px 8px;overflow:auto;white-space:nowrap;';

  var copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  styleButton(copy, false);
  copy.addEventListener('click', function () {
    copyText(snippet.value);
    copy.textContent = 'Copied';
    track('snippet_copied', { client: snippet.client });
    setTimeout(function () {
      copy.textContent = 'Copy';
    }, 1400);
  });

  row.appendChild(label);
  row.appendChild(code);
  row.appendChild(copy);
  return row;
}

function makeAgentLinks() {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
  for (var i = 0; i < AGENT_LINKS.length; i++) {
    (function (link) {
      var anchor = document.createElement('a');
      anchor.textContent = link.label;
      anchor.href = link.href;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      styleButton(anchor, false);
      anchor.style.textDecoration = 'none';
      anchor.addEventListener('click', function () {
        track('docs_opened', { target: 'agent_install' });
      });
      wrap.appendChild(anchor);
    })(AGENT_LINKS[i]);
  }
  return wrap;
}

function buildPanel() {
  var backdrop = document.createElement('div');
  backdrop.id = 'comfy-desktop-mcp-panel';
  backdrop.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(0,0,0,0.45);';

  var card = document.createElement('div');
  card.style.cssText =
    'width:min(560px,92vw);max-height:82vh;overflow:auto;border-radius:12px;' +
    'padding:22px;background:var(--comfy-menu-bg,#1e1e1e);color:var(--fg-color,#e5e5e5);' +
    'box-shadow:0 18px 60px rgba(0,0,0,0.5);font-size:14px;';

  var title = document.createElement('div');
  title.textContent = 'Connect an agent with Comfy MCP';
  title.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:4px;';

  var subtitle = document.createElement('div');
  subtitle.textContent =
    'Run your own AI agent against this ComfyUI over MCP — right inside the desktop terminal.';
  subtitle.style.cssText = 'opacity:0.72;margin-bottom:16px;line-height:1.4;';

  var haveHeading = document.createElement('div');
  haveHeading.textContent = 'Already have an agent?';
  haveHeading.style.cssText = 'font-weight:600;margin-bottom:2px;';

  var haveHint = document.createElement('div');
  haveHint.textContent = 'Install the server, then add it to your agent:';
  haveHint.style.cssText = 'opacity:0.72;font-size:13px;';

  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(haveHeading);
  card.appendChild(haveHint);
  card.appendChild(makeSnippetRow({ client: 'install', label: 'Install', value: 'pip install comfy-mcp' }));
  for (var i = 0; i < SNIPPETS.length; i++) {
    card.appendChild(makeSnippetRow(SNIPPETS[i]));
  }

  var noHeading = document.createElement('div');
  noHeading.textContent = 'No agent yet?';
  noHeading.style.cssText = 'font-weight:600;margin:18px 0 2px;';

  var noHint = document.createElement('div');
  noHint.textContent = 'Grab one of these, then come back and connect:';
  noHint.style.cssText = 'opacity:0.72;font-size:13px;';

  card.appendChild(noHeading);
  card.appendChild(noHint);
  card.appendChild(makeAgentLinks());

  var footer = document.createElement('div');
  footer.style.cssText =
    'display:flex;align-items:center;gap:10px;margin-top:22px;';

  var openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = 'Open terminal';
  styleButton(openBtn, true);
  openBtn.addEventListener('click', function () {
    track('path_selected', { path: 'have_agent' });
    openTerminal();
    closePanel();
  });

  var docsBtn = document.createElement('a');
  docsBtn.textContent = 'Read the docs';
  docsBtn.href = DOCS_LOCAL;
  docsBtn.target = '_blank';
  docsBtn.rel = 'noreferrer';
  styleButton(docsBtn, false);
  docsBtn.style.textDecoration = 'none';
  docsBtn.addEventListener('click', function () {
    track('docs_opened', { target: 'mcp_local' });
  });

  var spacer = document.createElement('div');
  spacer.style.flex = '1';

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  styleButton(closeBtn, false);
  closeBtn.addEventListener('click', function () {
    track('panel_dismissed', { stage: 'panel' });
    closePanel();
  });

  footer.appendChild(openBtn);
  footer.appendChild(docsBtn);
  footer.appendChild(spacer);
  footer.appendChild(closeBtn);
  card.appendChild(footer);

  backdrop.appendChild(card);
  backdrop.addEventListener('click', function (event) {
    if (event.target === backdrop) {
      track('panel_dismissed', { stage: 'backdrop' });
      closePanel();
    }
  });
  return backdrop;
}

function closePanel() {
  var existing = document.getElementById('comfy-desktop-mcp-panel');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

function openPanel() {
  if (document.getElementById('comfy-desktop-mcp-panel')) return;
  document.body.appendChild(buildPanel());
  track('panel_opened', { entrypoint: 'nudge' });
}

function buildNudge() {
  var nudge = document.createElement('div');
  nudge.id = 'comfy-desktop-mcp-nudge';
  nudge.style.cssText =
    'position:fixed;right:18px;bottom:18px;z-index:2147483646;display:flex;' +
    'align-items:center;gap:10px;max-width:340px;padding:12px 14px;border-radius:10px;' +
    'background:var(--comfy-menu-bg,#1e1e1e);color:var(--fg-color,#e5e5e5);' +
    'box-shadow:0 10px 34px rgba(0,0,0,0.42);font-size:13px;line-height:1.35;';

  var text = document.createElement('div');
  text.style.flex = '1';
  text.innerHTML =
    '<strong>Comfy has an MCP.</strong> Connect your AI agent to this install.';

  var connect = document.createElement('button');
  connect.type = 'button';
  connect.textContent = 'Connect';
  styleButton(connect, true);
  connect.addEventListener('click', function () {
    dismissNudge();
    openPanel();
  });

  var close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.style.cssText =
    'cursor:pointer;border:0;background:transparent;color:currentColor;' +
    'font-size:18px;line-height:1;opacity:0.6;padding:2px 4px;';
  close.addEventListener('click', function () {
    dismissNudge();
    track('panel_dismissed', { stage: 'nudge' });
  });

  nudge.appendChild(text);
  nudge.appendChild(connect);
  nudge.appendChild(close);
  return nudge;
}

function dismissNudge() {
  markDismissed();
  var existing = document.getElementById('comfy-desktop-mcp-nudge');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

function showNudge() {
  if (isDismissed()) return;
  if (document.getElementById('comfy-desktop-mcp-nudge')) return;
  document.body.appendChild(buildNudge());
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
    `if (typeof window.__comfyDesktop2.openTerminal !== 'function') return;\n` +
    `if (window.__comfyDesktopMcpNudge) return;\n` +
    `window.__comfyDesktopMcpNudge = true;\n` +
    MCP_NUDGE_MAIN_JS +
    `})();\n`
  return cachedScript
}
