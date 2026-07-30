/**
 * Returns a self-contained script that removes the false Firebase popup error
 * produced when Desktop denies the embedded auth popup and takes over with its
 * system-browser sign-in flow.
 *
 * Both Cloud and local ComfyUI views use the same Firebase popup interception,
 * so the suppressor must run in both. It only matches the raw popup-blocked
 * error or the frontend's dedicated user-facing sign-in failure copy.
 */
export function getComfyAuthPopupErrorContentScript(): string {
  return (
    `(function(){` +
    `if(window.__comfyDesktopAuthPopupErrorSuppressor)return;` +
    `function looksBlocked(n){` +
    `if(!n||n.nodeType!==1)return false;` +
    `var t=(n.textContent||'').toLowerCase();` +
    `return t.indexOf('auth/popup-blocked')>=0` +
    `||t.indexOf('signing you in')>=0;` +
    `}` +
    `function nukeToast(n){` +
    `var root=(n.closest&&n.closest('.p-toast-message,.p-toast-item,[role=alert]'))||n;` +
    `try{root.remove()}catch(_){}` +
    `}` +
    `var observer=new MutationObserver(function(muts){` +
    `for(var i=0;i<muts.length;i++){` +
    `var added=muts[i].addedNodes;` +
    `for(var j=0;j<added.length;j++){` +
    `var n=added[j];` +
    `if(looksBlocked(n)){nukeToast(n);continue;}` +
    `if(n.querySelectorAll){` +
    `var hits=n.querySelectorAll('*');` +
    `for(var k=0;k<hits.length;k++){` +
    `if(looksBlocked(hits[k])){nukeToast(hits[k]);break;}` +
    `}` +
    `}` +
    `}` +
    `}` +
    `});` +
    `window.__comfyDesktopAuthPopupErrorSuppressor=observer;` +
    `observer.observe(document.documentElement,{childList:true,subtree:true});` +
    `})()`
  )
}
