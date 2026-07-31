/**
 * Persistent Desktop sign-in panel injected into the embedded Cloud view.
 *
 * The system-browser handoff is not proof that a browser page loaded:
 * `shell.openExternal()` only confirms that the OS accepted the request. This
 * panel therefore stays visible for the lifetime of the sign-in attempt and
 * gives the user durable recovery controls.
 */

export const COPY_LINK_BANNER_ID = 'comfy-copy-login-banner'

/**
 * Page-to-main commands. The listener is installed only while a Desktop-owned
 * auth attempt is active, and every command operates on that attempt's trusted
 * URL or AbortController.
 */
export const OPEN_LINK_SENTINEL = '__comfyOpenLoginLink'
export const CANCEL_SIGN_IN_SENTINEL = '__comfyCancelLogin'
export const START_OVER_SENTINEL = '__comfyStartLoginOver'

export type SignInPanelStatus = 'opening' | 'waiting' | 'open_failed' | 'expired' | 'failed'

export interface CopyLinkBannerLabels {
  title: string
  opening: string
  waiting: string
  openFailed: string
  expired: string
  failed: string
  remaining: string
  copy: string
  copied: string
  openAgain: string
  cancel: string
  startOver: string
}

export interface CopyLinkBannerOptions {
  /** Absolute wall-clock deadline. Omit for the legacy loopback flow. */
  expiresAtMs?: number
  status?: SignInPanelStatus
}

// Values mirror the Comfy Desktop brand tokens defined in
// `src/renderer/src/assets/main.css`. CSS vars do not cross into the Cloud
// webview, so resolved colors are inlined here.
export const COPY_LINK_BANNER_CSS =
  `#${COPY_LINK_BANNER_ID}{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);` +
  `z-index:2147483647;display:grid;gap:12px;width:min(620px,calc(100vw - 32px));` +
  `background:#2c2533;color:#c2bfb9;font:13px/1.45 system-ui,-apple-system,sans-serif;` +
  `padding:14px 16px;border:1px solid rgba(255,255,255,0.12);border-radius:12px;` +
  `box-shadow:0 12px 36px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.2);box-sizing:border-box;}` +
  `#${COPY_LINK_BANNER_ID} .ccl-head{display:flex;align-items:flex-start;gap:10px;min-width:0;}` +
  `#${COPY_LINK_BANNER_ID} .ccl-dot{flex:0 0 auto;width:8px;height:8px;margin-top:6px;border-radius:50%;background:#0b8ce9;}` +
  `#${COPY_LINK_BANNER_ID}[data-status="open_failed"] .ccl-dot,` +
  `#${COPY_LINK_BANNER_ID}[data-status="failed"] .ccl-dot{background:#f59e0b;}` +
  `#${COPY_LINK_BANNER_ID}[data-status="expired"] .ccl-dot{background:#8a8688;}` +
  `#${COPY_LINK_BANNER_ID} .ccl-copy{flex:1 1 auto;min-width:0;}` +
  `#${COPY_LINK_BANNER_ID} .ccl-title{display:block;color:#fff;font-weight:600;font-size:14px;}` +
  `#${COPY_LINK_BANNER_ID} .ccl-status{display:block;color:#c2bfb9;margin-top:2px;}` +
  `#${COPY_LINK_BANNER_ID} .ccl-time{flex:0 0 auto;color:#8a8688;font-variant-numeric:tabular-nums;white-space:nowrap;}` +
  `#${COPY_LINK_BANNER_ID} .ccl-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}` +
  `#${COPY_LINK_BANNER_ID} button{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;` +
  `cursor:pointer;border-radius:8px;font:13px/1 system-ui,sans-serif;padding:8px 12px;` +
  `border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:#c2bfb9;` +
  `transition:background 120ms ease,border-color 120ms ease,color 120ms ease;}` +
  `#${COPY_LINK_BANNER_ID} button:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.22);color:#fff;}` +
  `#${COPY_LINK_BANNER_ID} button:disabled{cursor:not-allowed;opacity:.45;}` +
  `#${COPY_LINK_BANNER_ID} .ccl-ico{display:inline-flex;align-items:center;}` +
  `#${COPY_LINK_BANNER_ID} button.ccl-primary{background:#0b8ce9;color:#fff;border-color:#0b8ce9;}` +
  `#${COPY_LINK_BANNER_ID} button.ccl-primary:hover{background:#0a7dd1;border-color:#0a7dd1;color:#fff;}` +
  `#${COPY_LINK_BANNER_ID} button.ccl-done{background:#f2ff59;color:#100c13;border-color:#f2ff59;}` +
  `#${COPY_LINK_BANNER_ID} button.ccl-link{margin-left:auto;border-color:transparent;background:transparent;color:#8a8688;}` +
  `#${COPY_LINK_BANNER_ID} button.ccl-link:hover{background:transparent;color:#fff;}` +
  `@media(max-width:560px){#${COPY_LINK_BANNER_ID} .ccl-time{width:100%;padding-left:18px;}` +
  `#${COPY_LINK_BANNER_ID} button.ccl-link{margin-left:0;}}`

/**
 * Build the page-context IIFE that renders the panel. Every interpolated value
 * is JSON-escaped before it enters executable source.
 */
export function buildCopyLinkBannerScript(
  url: string,
  labels: CopyLinkBannerLabels,
  options: CopyLinkBannerOptions = {}
): string {
  const u = JSON.stringify(url)
  const id = JSON.stringify(COPY_LINK_BANNER_ID)
  const status = JSON.stringify(options.status ?? 'opening')
  const expiresAt = JSON.stringify(options.expiresAtMs ?? null)
  const openToken = JSON.stringify(OPEN_LINK_SENTINEL)
  const cancelToken = JSON.stringify(CANCEL_SIGN_IN_SENTINEL)
  const startOverToken = JSON.stringify(START_OVER_SENTINEL)
  const l = Object.fromEntries(
    Object.entries(labels).map(([key, value]) => [key, JSON.stringify(value)])
  ) as Record<keyof CopyLinkBannerLabels, string>

  return `(function(){try{
    var URL=${u},ID=${id},STATUS=${status},EXPIRES_AT=${expiresAt};
    var existing=document.getElementById(ID);
    if(existing){
      existing.__cclUrl=URL;existing.__cclStatus=STATUS;existing.__cclExpiresAt=EXPIRES_AT;
      if(existing.__cclRender)existing.__cclRender();return;
    }
    var bar=document.createElement('section');bar.id=ID;bar.setAttribute('role','status');
    bar.__cclUrl=URL;bar.__cclStatus=STATUS;bar.__cclExpiresAt=EXPIRES_AT;
    function svg(p){return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';}
    var ICON_COPY=svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
    var ICON_TICK=svg('<path d="M20 6 9 17l-5-5"/>');
    var ICON_OPEN=svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
    function makeBtn(cls,icon,text){
      var b=document.createElement('button');b.type='button';if(cls)b.className=cls;
      if(icon){var i=document.createElement('span');i.className='ccl-ico';i.innerHTML=icon;b.appendChild(i);b.__ico=i;}
      var t=document.createElement('span');t.textContent=text;b.appendChild(t);b.__lbl=t;return b;
    }
    var head=document.createElement('div');head.className='ccl-head';
    var dot=document.createElement('span');dot.className='ccl-dot';dot.setAttribute('aria-hidden','true');
    var text=document.createElement('div');text.className='ccl-copy';
    var title=document.createElement('span');title.className='ccl-title';title.textContent=${l.title};
    var statusEl=document.createElement('span');statusEl.className='ccl-status';
    var timeEl=document.createElement('span');timeEl.className='ccl-time';
    text.appendChild(title);text.appendChild(statusEl);head.appendChild(dot);head.appendChild(text);head.appendChild(timeEl);
    var actions=document.createElement('div');actions.className='ccl-actions';
    var open=makeBtn('ccl-primary',ICON_OPEN,${l.openAgain});
    var copy=makeBtn('',ICON_COPY,${l.copy});
    var startOver=makeBtn('',null,${l.startOver});
    var cancel=makeBtn('ccl-link',null,${l.cancel});
    actions.appendChild(open);actions.appendChild(copy);actions.appendChild(startOver);actions.appendChild(cancel);
    bar.appendChild(head);bar.appendChild(actions);
    function fallbackCopy(value){try{var ta=document.createElement('textarea');ta.value=value;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}catch(e){}}
    copy.addEventListener('click',function(){
      var value=bar.__cclUrl;
      var flash=function(){copy.__ico.innerHTML=ICON_TICK;copy.__lbl.textContent=${l.copied};copy.classList.add('ccl-done');setTimeout(function(){copy.__ico.innerHTML=ICON_COPY;copy.__lbl.textContent=${l.copy};copy.classList.remove('ccl-done');},1500);};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).then(flash,function(){fallbackCopy(value);flash();});}
      else{fallbackCopy(value);flash();}
    });
    open.addEventListener('click',function(){try{console.info(${openToken});}catch(e){}});
    startOver.addEventListener('click',function(){try{console.info(${startOverToken});}catch(e){}});
    cancel.addEventListener('click',function(){try{console.info(${cancelToken});}catch(e){}});
    function formatRemaining(ms){var total=Math.max(0,Math.ceil(ms/1000));var m=Math.floor(total/60);var s=String(total%60).padStart(2,'0');return m+':'+s;}
    function render(){
      var mode=bar.__cclStatus;
      var remaining=typeof bar.__cclExpiresAt==='number'?bar.__cclExpiresAt-Date.now():null;
      if(remaining!==null&&remaining<=0)mode=bar.__cclStatus='expired';
      bar.dataset.status=mode;
      statusEl.textContent=mode==='opening'?${l.opening}:mode==='open_failed'?${l.openFailed}:mode==='expired'?${l.expired}:mode==='failed'?${l.failed}:${l.waiting};
      timeEl.textContent=remaining!==null&&remaining>0?${l.remaining}.replace('{time}',formatRemaining(remaining)):'';
      var terminal=mode==='expired'||mode==='failed';
      open.disabled=terminal;copy.disabled=terminal;
      startOver.classList.toggle('ccl-primary',terminal);
    }
    bar.__cclRender=render;render();
    bar.__cclTimer=setInterval(render,1000);
    document.body.appendChild(bar);
    var obs=new MutationObserver(function(){if(!document.getElementById(ID)&&bar.__cclUrl){document.body.appendChild(bar);}});
    obs.observe(document.body,{childList:true});bar.__cclObs=obs;
  }catch(e){}})()`
}

/** Update the live panel without rebuilding it. */
export function buildUpdateCopyLinkBannerScript(status: SignInPanelStatus): string {
  const id = JSON.stringify(COPY_LINK_BANNER_ID)
  const nextStatus = JSON.stringify(status)
  return `(function(){try{var b=document.getElementById(${id});if(b){b.__cclStatus=${nextStatus};if(b.__cclRender)b.__cclRender();}}catch(e){}})()`
}

/** Remove the panel, its countdown, and its resurrection observer. */
export function buildRemoveCopyLinkBannerScript(): string {
  const id = JSON.stringify(COPY_LINK_BANNER_ID)
  return `(function(){try{var b=document.getElementById(${id});if(b){if(b.__cclTimer)clearInterval(b.__cclTimer);if(b.__cclObs)b.__cclObs.disconnect();b.remove();}}catch(e){}})()`
}
