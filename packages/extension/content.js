// pitstop drawer — content script
//
// Runs on every localhost page (per manifest matches). Injects the daemon's
// inject.js into the page so the drawer mounts. Idempotent — won't double-inject
// when SPAs re-render or push new history entries.
//
// We deliberately do NOT pass a `pitstop-project` query param. The drawer's
// bootstrap falls back to `/api/sessions/most-recent-active`, which returns
// whichever non-complete session was last touched across any project root.
// That keeps the extension zero-configuration: install once, every project's
// drawer just appears wherever an active session exists.
//
// We also skip the daemon's own URL (localhost:7773) — no point injecting the
// drawer into the daemon's own /demo or session pages.

(() => {
  const PITSTOP_DAEMON_PORT = '7773';
  const TAG_ID = 'pitstop-extension-injected';

  const isPitstopDaemon = location.port === PITSTOP_DAEMON_PORT;
  if (isPitstopDaemon) return;

  const inject = () => {
    if (document.getElementById(TAG_ID)) return;
    if (!document.head && !document.body) return;
    const s = document.createElement('script');
    s.id = TAG_ID;
    s.src = `http://localhost:${PITSTOP_DAEMON_PORT}/inject.js`;
    s.defer = true;
    s.dataset.injectedBy = 'pitstop-chrome-extension';
    (document.head || document.body).appendChild(s);
  };

  inject();

  // SPAs sometimes wipe the head between route transitions. Re-check on a
  // micro-budget so the drawer reappears after framework navigations.
  const observer = new MutationObserver(() => {
    if (!document.getElementById(TAG_ID)) inject();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
