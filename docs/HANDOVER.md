# Handover: Shumon (朱門) — the vermilion gate

You are taking over an in-progress browser game. Read this whole file, then
`docs/GAME.md` (the state and audio contract), `docs/INTRO.md` (the entry
sequence spec), and `~/.claude/skills/sri-design/SKILL.md` (the design
method every UI change follows). Work in `~/workspace/temple-night`.

## What it is

A three-to-five-minute samurai duel game in the browser: hold the vermilion
torii of a mountain temple at night through three waves of fighters, each
wave opened by a standoff (hold Space, release on the flinch). Inspired by
Ghost of Tsushima's combat and menus; nothing is copied from it. The game
the player sees is **Shumon**, subtitle **The Vermilion Gate**; the repo,
the scene and the CSS class names keep the working name Temple Night.

Stack: Vite + React + TypeScript host, Three.js pinned at **0.149.0** (use
`texture.encoding`, not `colorSpace`), Rapier for movement collision, no
backend, no binary art beyond two CC0 assets. GitHub:
`srikarsunchu/temple-night` (private), branch `master`.

## Owner's taste (this matters more than anything below)

- He hates generic output. The test is "a designer could not tell a model
  made it". Real type, real references, one idea per screen, no mood-copy
  paragraphs, no "welcome", no purple/indigo/orange accents.
- The **captured library motion beats hand-authored poses** every time. He
  rejected authored idle, sword and cut clips as stiff; the Quaternius
  library and the procedural draw are in charge. Keep it that way unless a
  clip is provably better on screen.
- Enemies must be **the same quality as the player**, not primitives.
- He plays the real game in his own browser and reports what he sees:
  "the walk stalls", "I can see his ass from the back", "Space doesn't
  work". Assume every report is real and reproduce it before arguing.
- Commit when work is verified; he says "push" when he wants GitHub.

## Where things live

| Area | File |
|---|---|
| Controller: phases, waves, standoff, health, cuts, parry, dodge, camera | `src/shaders/temple-night/templeGameplay.js` |
| Enemy pool, AI, hit/kill API | `templeEnemies.js` |
| Player rig (procedural joints + canvas-painted armour) | `templeSamurai.js` |
| Skinned MakeHuman body worn over the rig | `templeBody.js`, asset `public/assets/samurai/body.glb` + `body.json` |
| Quaternius clip retarget (distance-driven locomotion, scrubbed attack) | `templeAnimation.js` |
| Authored pose clips (loaded only when listed in `CLIP_NAMES`) | `templePoseClips.js`, `public/anim/clips/*.json`, specs `anim/poses/*.json` |
| World: landscape, sky dome, edge rim, path | `templeLandscape.js` (+ small hooks in the generated `templeNightRenderer.js`) |
| Audio, all synthesised | `templeAudio.js` |
| Physics, boundary | `templePhysics.js` |
| React host, all UI | `TempleNightScene.tsx`, strings in `copy.ts`, styles in `src/shaders/threeui.css` |
| Agent tools on `document.modelContext` | `templeAgentControls.js` |
| Body build (Blender headless, MPFB2) | `tools/character/*` |
| Pose authoring over open-media's MCP bridge | `scripts/anim/author.mjs`, `probe.mjs`, `shotsink.mjs` |

Tests: `npm test` (Node, DOM stub: gameplay, combat, clips, body). Build:
`npm run build` (tsc + vite). Dev: `npm run dev` (port 5173).

## How to verify in the desktop app's browser pane

The pane is usually hidden, and a hidden pane never fires
requestAnimationFrame, so the world never reaches `ready`. In the page run:

```js
Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);
window.cancelAnimationFrame=id=>clearTimeout(id);
document.dispatchEvent(new Event('visibilitychange'));
```

If a native frame is already pending, bounce `hidden` true→false with two
`visibilitychange` events. Screenshots time out while hidden; capture the
WebGL canvas right after a render (`canvas.toDataURL` inside the patched
rAF) and POST it to `node scripts/anim/shotsink.mjs` (port 5177), then Read
the jpg. To drive the controller without the UI, find the game object via
React's fiber on `.temple-night-scene` (walk `return`, scan hook
`memoizedState.current` for an object with `getState` and `start`).

## Current state (committed)

Landed and tested:
- Combat and enemies per `docs/GAME.md` (17 test groups pass).
- Presentation pass: OFL fonts (Cormorant Garamond, Jost, Noto Serif JP
  subset) self-hosted in `public/fonts`, tokens, HUD that rests dim,
  standoff letterbox, banners, damage vignette, pause, death and victory
  cards. Digest at `~/workspace/sri-design/references/ghost-of-tsushima-hud.md`.
- World mood: authored starfield sky on a dome, night-value ground and
  grass, layered crowns, path from the gate, edge rim + fog bands,
  rain/leaves/ripples back in game mode; physics bounds pulled to
  |x|<52, −66<z<42. Post grade hook `WORLD.grade` driven by hits and
  standoffs.
- Walk stutter fixed (locomotion clips scrubbed from the gait phase; the
  resolution scaler has hysteresis).
- `start()` is a no-op mid-run (a repeat call used to clear the standoff hold).

Also landed (not yet play-tested end to end together with combat):
- **Intro sequence** per `docs/INTRO.md` in `TempleNightScene.tsx`,
  `copy.ts`, `threeui.css`, `index.html`: boot black → brush-stroke loader
  at real progress (body .45, forms .30, ground .12, ink .05, warm frame
  .08) → 朱門 / SHUMON / THE VERMILION GATE / PRESS ANY KEY over the live
  scene with a ±2° look sway → 250 ms cut → 一 THE GATE / NIGHT ONE →
  900 ms fade onto the standoff. HOLD SPACE and F — PARRY are taught once
  per run; wave cards 二/三; THE GATE FALLS / THE NIGHT PASSES cards with
  Enter to restart, Esc or 30 s idle to the title; pause resumes on click
  or Enter (never "Esc to resume"). `window.__templeNightMock()` and
  `?mock=` drive every UI state for captures.

- **Enemy quality**: skinned bodies on enemies (`loadBody(rig, { face: false })`),
  `mask` and armour `palette` options on the rig (`sakai`, `raider`, `iron`,
  `ash`), library reactions via `s.react` (`Hit_Chest`, `Hit_Head`,
  `Death01`, `Roll`) and the telegraph via `s.telegraph` in
  `templeAnimation.js`; a mirrored-retarget bug in the enemy clone fixed.
- Integration play-through done in the pane: standoff → perfect → clear →
  wave 2 shieldman walking in, no pause, no errors. 17 test groups, build green.

## Open bugs and gaps

1. **Space in the standoff.** Root cause found: the UI's "any key" handling
   called `start()` mid-run. The controller side is fixed; confirm the
   rewritten intro's key handler never calls `start()` while `active`, and
   that no button keeps focus (Space on a focused button clicks it).
2. **Damage feel** was reported as off. Check: cut reach 1.9 m / ±50°,
   enemy hit reactions visible, `hitFlash` vignette and `audio.hit()`
   audible, parry window .28 s readable. Tune on screen, not in tests.
3. Enemies are masked and re-armoured but share the player's body; a
   second MakeHuman build with different macros would make them distinct men.
4. The landscape faces the mood now, but nothing in the field is placed by
   hand; the temple side is the crafted side.
5. `PLAYABLE STUDY` edition marks, "wander" copy and Georgia should all be
   gone; grep for them.

## Rules of the road

- Do not edit `templeNightRenderer.js` beyond the marked game hooks.
- Keep `npm test` green under Node: every browser-only loader is gated on
  `typeof document.createElement === 'function'`.
- The pose pipeline is optional tooling; do not re-enable authored clips
  by default.
- Rebuilding the body: `tools/character/README.md` (Blender 5.0.1 +
  MPFB2 master; `--hair ponytail01 --shoes shoes03 --tri-budget 38000`).
- Before ending a session: tests, build, a real play-through, commit with a
  message that says what changed and why; push only when asked.
