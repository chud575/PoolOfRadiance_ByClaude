# Agent rules (read ARCHITECTURE.md for detail)

* **Ownership**: only edit the paths your workstream owns (table in ARCHITECTURE.md). Need a shared API?
  Add it minimally and mention it in your commit message. Scenes never import other scenes.
* **Determinism**: game logic uses `ctx.rng` (seeded), animation uses `ctx.clock.time`. Never `Math.random()`
  in logic or `performance.now()` for animation. Frozen clock (`dt === 0`) ⇒ render the settled state.
* **All art is procedural** (canvas/shaders/geometry). The web is blocked: no asset URLs, no downloads.
* **Before committing**: `npm run build` and `npm test` must pass, and capture the shots for what you touched:
  `node tools/shotall.mjs --only <names>` (and look at them with the Read tool). No page errors allowed.
  For flow changes also run `node tools/smoke.mjs`.
* **Chromium**: use tools/lib/browser.mjs (SwiftShader executablePath). Never run `playwright install`.
  If several agents shoot at once, pass `--port <unique>` to shot.mjs.
* **Git**: commit only your own paths with `git add <paths>` (never `git add -A`/`.`). If `.git/index.lock`
  exists, wait 1–2 s and retry (other agents commit concurrently). Pull/rebase before pushing; retry push
  with backoff on network errors. End commit messages with the session attribution lines you were given.
* **Debug URLs**: `?scene=explore&map=phlan_slums&x=7&y=11&dir=N&t=2` etc. — see ARCHITECTURE.md. Add new
  gallery entries in `tools/gallery.mjs`.
* **Quality bar**: AAA (see ARCHITECTURE.md "The AAA visual bar"), while staying recognisably Gold Box.
