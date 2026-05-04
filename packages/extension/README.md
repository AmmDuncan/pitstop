# Pitstop drawer · Chrome extension

Injects the pitstop drawer into every `localhost:*` page. Zero edits to your dev app — the drawer just appears.

## Install (unpacked)

1. Open `chrome://extensions/`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (`packages/extension/`).
4. The pitstop icon should appear in your toolbar; the drawer will now mount on any `localhost:*` page that has an active pitstop session.

That's it. Survives browser restarts, works across all your local dev ports, no per-project setup.

## How it works

`content.js` runs at `document_idle` on every `localhost:*` page (per `manifest.json`'s `host_permissions`). It appends a single `<script src="http://localhost:7773/inject.js" defer>` tag and watches for SPA route transitions to re-inject if needed. The drawer's bootstrap then asks the daemon for the most-recently-active session and connects.

No `pitstop-project` query param is set, so this works across any project — whichever session you started most recently is the one you'll see.

## Why an extension instead of editing nuxt.config / vite.config

Committing a `<script>` tag (even one gated by `NODE_ENV === 'development'`) means every teammate carries pitstop wiring in their repo whether they use it or not. The extension keeps the wiring on your machine, not in the team's history.

## Updating

Re-pull the pitstop repo, then in `chrome://extensions/` click the **Reload** button on the pitstop card. Manifest changes need a reload; `content.js` changes are picked up on each page navigation.

## Uninstall

`chrome://extensions/` → toggle pitstop off, or click **Remove**.
