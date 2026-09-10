> Name: the game is **Shumon** (朱門, the vermilion gate), subtitle *The Vermilion Gate*. Where this spec says Shumon it used to say Temple Night; the repository keeps that working name.

# Shumon — The First Two Minutes

Spec for everything between opening the page and the first parry. Replaces
`game-entry` in `TempleNightScene.tsx`. Phases, standoff timings and audio
names come from `docs/GAME.md` and are not changed here.

## 1. Survey

**Ghost of Tsushima.** Title: a lone katana planted in the ground, a storm
turning behind it, wind moving the grass; the image changes three times as
the story advances (one sword, two swords, then the mask). Loading was cut to
~2 s and the team deliberately *slowed* the death reload so a tip could be
read; the Director's Cut on PS5 has no loading screen at all. Every mission
opens with a title card: Japanese above, the English title below, laid over a
still of the place. Combat is taught inside the story: the Komoda Beach charge
is the tutorial, a flashback with Lord Shimura teaches parry and dodge, and the
first standoff is a scripted hold-Triangle, release-on-the-tell moment with the
one rule "watch the feet". [1][2][3][4]

**Ghost of Yōtei.** Opens in medias res; the tutorial doubles as the first
boss (the Snake) and the title drops only after the prologue ends. The standoff
is now an explicit L1 challenge, then hold Triangle and release on the
opponent's move. Menus were redesigned so "the game comes to you": allies
gather at the campfire under the stars instead of a journal. [5][6]

**Sekiro.** Black title, white brush kanji, "press any button". The first
minutes are a well, a letter, and one prompt per mechanic in sequence (jump,
wall-hug, crouch, eavesdrop) before any sword; the first mini-boss is the
posture and deflect lesson; the first death (Genichiro) is unavoidable and
narrative. On death a single red kanji fills the screen and a resurrect prompt
waits about 20 s. [7]

**Nioh.** Starts in a cell; the tutorial is a corridor of found notes (dash,
guard, evasion) and one soldier, ending in the Derrick boss and the first real
mission. Missions are chosen from a map, each a self-contained load. Death
leaves your Amrita on the floor to be reclaimed. [8]

**Trek to Yomi.** Black and white from the title screen on: heavy grain,
burn-in and scratches, forced letterbox that widens or tightens per scene.
Chapter one is a lesson with the master Sanjuro — light, heavy, block, parry —
staged as the story, not as a menu. [9]

**Rise of the Ronin.** Character creation, then a village tutorial where NPC
sparring teaches block, dodge and Counterspark before the first boss (the
Bladesmith); the Black Ship mission is the first real one. Instruction is by
fight, but with many on-screen lines. [10]

**The Legend of Kage (Taito, 1985).** Attract demo, title (dated MCMLXXXIV),
then a one-screen intro: the princess is carried off and Kage drops out of the
trees. Two buttons, up to jump; the first stage teaches by leaping through
treetops before anyone dangerous appears. [11]

**Ninja Gaiden (NES).** Thirteen-shot opening: two ninjas in a moonlit field,
close-ups of faces and feet, the leap, the clash, a freeze that flashes black
and white, one falls. Then text. The title holds until Start. [12]

**Getsu Fūma Den.** Story in a few lines of text — two brothers set out and are
killed — then straight to an overworld and a side-scrolling stage. Night,
moon and horror imagery carry the tone; the text does not explain. [13]

**Shinobi / Shadow Dancer.** Each mission starts with a briefing card: a
photograph of the boss and a map pin for the next stage. Attract mode plays
the game itself; a bonus stage between missions is a shuriken breather. [14]

**The Legend of Zelda / Kid Icarus (NES).** Zelda: waterfall under a pink sky,
"PUSH START BUTTON"; after 9 s idle the sky goes to night, a scrolling story
rises, then "ALL OF TREASURES", and the loop repeats. Kid Icarus is simply a
title with START / CONTINUE selected by Select. [15]

**Castlevania (NES).** After the title, Simon walks to the gate as bats cross
and a cloud passes the moon, to "Vampire Killer"; the first screen has no
enemies, only candles to whip. Fake film credits at the end. [16]

**Brave Fencer Musashi.** The manual: after the PlayStation logo "both a demo
and title will be shown"; the game opens in a forest where the first enemy is
the first lesson (assimilate it). [17]

**Attract mode, generally.** Demo play, backstory, high scores, a blinking
"insert coin": a loop that delivers identity fast. [18]

**Web conventions.** Web Audio starts suspended until a click, keydown or
pointerup; resume on that gesture. `requestPointerLock()` also needs a gesture,
Esc releases it, and re-locking needs a *new* gesture, so "Esc to resume" is
never honest — "click to resume" is. Loading over ~4 s must show progress with
a definite endpoint; never put the tutorial on the loading screen. [19][20][21]

## 2. Sequence

Times are from page open; loading is real, so "L" is when all assets resolve.

| # | t | Screen | Sound | Input |
|---|---|---|---|---|
| 1 | 0.0 s | Black. Nothing. Canvas mounted but hidden. | none (audio is suspended before a gesture) | none |
| 2 | 0.4 s → L | **Loading.** One horizontal brush stroke, centre, drawn left to right at real progress (§4). Under it, 11 px caps naming the stage: THE BODY / THE FORMS / THE GROUND / THE INK. The 月 seal at 30 % at bottom centre. | none | none |
| 3 | L → L+0.9 s | Stroke completes; the stage line fades. The canvas fades in *behind* the stroke (attract shot, §2a). | none | none |
| 4 | L+0.9 s | **Title.** 朱門 small above, SHUMON below, the stroke now its rule. 0.8 s later: PRESS ANY KEY, pulsing. Top-left brand stays; nothing else. Idle 60 s: shot changes (§2a); title never leaves. | none | any key or click → 5 |
| 5 | t0 | Gesture: `AudioContext.resume()`, `requestPointerLock()`, `audio.bell()` once. Title cuts to black in 250 ms (a cut, not a fade). | bell, then wind rising from 0 to bed level over 2 s | — |
| 6 | t0+0.25 → t0+3.2 s | **Chapter card.** Black. 一 small, THE GATE in brush type, thin rule, NIGHT ONE. The whole block drifts 6 px with the wind direction over the hold; out by sliding 12 px and fading 500 ms. | wind | none (any key skips at 1.2 s) |
| 7 | t0+3.2 s | Fade from black 900 ms straight onto the camera **already behind the player**, sheathed, at the foot of the steps facing the torii. Letterbox bars already in. No HUD. Rain and insects at ambience level. | ambience, rain | move to skip standoff (GAME.md) |
| 8 | t0+4.5 s | **First enemy** walks through the torii and stops at 6 m. When he stops: HOLD SPACE under the lower bar, standoff drum. Flinch after 1.6–4.2 s. Release → PERFECT / EARLY / LATE result line for 1.2 s. If pointer lock was refused: RIGHT-DRAG TO LOOK once, at the moment the camera arrives, 3 s. | `standoffDrum`, `flinch`, `draw`, `sword` | Space hold/release |
| 9 | first telegraph | **Parry line.** The first time any enemy raises the blade against the player (the .6 s tell), F — PARRY beside the target for the length of the tell. Shown once per session. Nothing else is ever taught in words. HUD (§4) draws in at fight start. | `parry`/`guard` on the outcome | F |
| 10 | wave clear | 3 s clear: banner THE GATE HOLDS, health +30, then the next card in-world (not on black): 二 SHIELD AND SPEAR, 三 THE BRUTE, 1.6 s each. Stance glyphs enter the HUD with the wave-2 card; the matching glyph pulses once when a new enemy type steps through the gate. That is the whole stance lesson. | `bell` per wave | — |
| 11 | death | Hit that kills: 0.4× time for 0.6 s, saturation to 0, `Death01`, 1.2 s to black. **Death card:** THE GATE FALLS, one line `wave 2 · 1:48`, then ENTER — AGAIN / ESC — TITLE. | `death`, wind only | Enter → 12; Esc or 30 s idle → title (4) |
| 12 | restart | Black 250 ms, chapter card at 1.6 s (not 3 s), no hints unless the standoff was never won. Camera behind the player as in 7. Pointer lock is re-requested on Enter (a key is a gesture). | bell | — |
| 13 | victory | Last enemy falls: 1.5 s hold on the body, letterbox in, fade 900 ms. **Victory card:** THE NIGHT PASSES; `3 waves · 4:12 · 2 perfect`; ENTER — AGAIN / ESC — TITLE. | `victory`, insects | Enter → 12; Esc or 30 s idle → 4 |
| 14 | pause | Esc anywhere in play: pointer unlocks, sim pauses, card PAUSED with the full controls table (the only place it exists) and CLICK TO RESUME. | bed ducks −12 dB | click → lock + resume |

**2a. Attract shots.** The title sits over the live scene. Shot A: the gate
from 9 m, camera at 1.6 m, a 14 s dolly of 1.2 m with 2° of yaw, ease in-out,
ping-pong. Shot B (after 60 s idle, and alternating): a swordsman walks through
the torii, stops, looks up the steps, turns and leaves; 12 s; then back to A.
Rain on, no HUD, no player body in frame. The demo never fights — the fight is
what the key buys.

**Returning to the title:** Esc on either end card, 30 s idle on an end card,
or the tab hidden for more than 60 s while paused. The canvas is already warm,
so the title returns in a 400 ms fade.

## 3. Copy

An `intro` slice to merge into the existing `copy` in
`src/shaders/temple-night/copy.ts`; it supersedes `title.begin`,
`title.beginAgain`, `title.loading`, `title.subtitle`, `title.edition`,
`title.pointerHint` and `hud.hintRow`, which should be deleted.

```ts
export const intro = {
  brand: { mark: '月', name: 'SHUMON' },
  loading: { body: 'THE BODY', forms: 'THE FORMS', ground: 'THE GROUND', ink: 'THE INK' },
  title:   { kanji: '朱門', name: 'SHUMON', prompt: 'PRESS ANY KEY' },
  chapter: {
    night: 'NIGHT ONE',
    waves: [
      { numeral: '一', name: 'THE GATE' },
      { numeral: '二', name: 'SHIELD AND SPEAR' },
      { numeral: '三', name: 'THE BRUTE' },
    ],
  },
  hint: {
    standoff: 'HOLD SPACE',
    parry: 'F — PARRY',
    look: 'RIGHT-DRAG TO LOOK',
  },
  result: { perfect: 'ONE CUT', early: 'TOO SOON', late: 'TOO LATE' },
  banner: { clear: 'THE GATE HOLDS' },
  pause: {
    title: 'PAUSED',
    resume: 'CLICK TO RESUME',
    controls: [
      ['W A S D', 'Move'], ['Shift', 'Run'], ['Mouse', 'Look'],
      ['Click / Space', 'Cut'], ['F', 'Guard · Parry'], ['Q', 'Dodge'],
      ['E', 'Draw · Sheathe'], ['1 2 3 4', '石 水 風 月'], ['M', 'Sound'],
    ],
  },
  death:   { title: 'THE GATE FALLS',  stats: (w: number, t: string) => `wave ${w} · ${t}` },
  victory: { title: 'THE NIGHT PASSES', stats: (w: number, t: string, p: number) => `${w} waves · ${t} · ${p} perfect` },
  endcard: { again: 'ENTER — AGAIN', title: 'ESC — TITLE' },
  sound:   { on: 'SOUND ON', off: 'SOUND OFF' },
  unavailable: (why: string) => `The night could not load: ${why}.`,
} as const;
```

Rules: caps for cards and hints; no welcome; no explanation of who the player
is or why enemies come; kanji never the only carrier of a meaning.

## 4. Type, motion, sound, loading

**Type.** Titles and cards in Cormorant Garamond (`public/fonts`), caps,
letter-spacing .18 em: 96 px title, 44 px card titles; hints and stage labels
in Jost 13 px caps, .2 em. Kanji in Noto Serif JP at 60 % of the roman size,
above and left-aligned to the roman (the Tsushima card layout). Off-white
`#e8e0cc` on black; `#913f33` for the seal only. No shadows; a hint gets a
1 px rule, never a box.

**Motion.** Black ↔ scene: 900 ms, `cubic-bezier(.4,0,.2,1)`. Title in: 600 ms
opacity + 8 px rise. Cuts (title→black, death→black) are 250 ms linear. Cards
drift with the wind vector of the audio `update(wind)` value: `x = wind * 6px`
over the hold, so the card is carried. Press-any-key pulses opacity .45→1 over
1.6 s sine. Letterbox bars: 120 ms in, 200 ms out. Slow-motion on death: 0.4×
for 600 ms then black. Nothing bounces; nothing scales.

**HUD.** Absent through steps 1–8. At `phase: 'fight'` the health rule draws in
over 400 ms bottom-left, wave counter top-right; stance glyphs join with the
wave-2 card. After 4 s with no damage, no attack and no key, everything fades
to 35 % over 800 ms and returns in 120 ms on any event. Target health only
while `target` exists.

**Sound per beat.** 2: silence. 5: `bell()` once, then `update(wind)` ramps the
bed 0→1 over 2 s. 6–7: wind and `ambience({rain, insects})`. 8: `standoffDrum
(true)` when the enemy stops, `flinch()` on the tell, `draw()` + `sword()` on
release, `standoffDrum(false)` on any result. 9: `parry()` / `guard()` / `hit()`.
10: `bell()` per wave card. 11: `death()`, everything but wind to 0 in 300 ms.
13: `victory()`. 14: bed −12 dB. `M` toggles; the toggle text lives in copy.

**Loading mechanics.** Kick everything off at mount, in parallel, and weight it:

| Item | Await | Progress source | Weight |
|---|---|---|---|
| body | `GLTFLoader.loadAsync('/assets/samurai/body.glb', onProgress)` + `body.json` | `loaded/total` when `lengthComputable`, else 0 until resolve | .45 |
| forms | `GLTFLoader.loadAsync('/assets/quaternius/animations.gltf', onProgress)` | as above | .25 |
| forms | the 12 clips under `/anim/clips/*.json` | resolved count / 12 | .05 |
| ground | `RAPIER.init()` (wasm compile, no progress) | 0 → 1 on resolve | .12 |
| ink | `document.fonts.load()` for Cormorant Garamond (roman, italic), Jost, Noto Serif JP in `public/fonts` | resolved / 4 | .05 |
| warm | one `renderer.compile(scene, camera)` + one hidden frame | 0 → 1 | .08 |

`progress = Σ weight × fraction`, each fraction capped at .99 until its promise
resolves. The displayed value is a follower: `shown += (progress − shown) ×
min(1, dt × 6)`, never decreasing, reaching 1 only when every promise has
resolved. The stroke's `stroke-dashoffset` is `(1 − shown) × length`. Stage
label = the heaviest unresolved item. Minimum time on screen 900 ms so a warm
cache still reads as a stroke, not a flicker. Failure of any item goes to the
existing `unavailable` state with `copy.unavailable(reason)`; nothing else on
the page ever mentions loading.

## 5. Remove from the current entry screen

- `A NIGHT TO WANDER` eyebrow — the game is a duel, and the line lies about it.
- `Rain on stone… Nowhere you need to be.` — mood copy contradicts the enemy walking through the gate.
- `Enter the grounds` / `Return to the night` / `Gathering the night…` button — a button needs the mouse; the gesture should be any key, and the three states hide the load.
- `WASD to wander · Mouse to look · Click to swing` hint block — controls taught before there is anything to control; move to the pause card.
- `If mouse capture is unavailable…` line — show the fallback only when the lock actually fails, once, in play.
- `PLAYABLE STUDY · 002` edition mark — portfolio label, not part of the fiction.
- The `game-controls` strip during play — a permanent legend defeats the HUD fade; the pause card owns it.
- The `↗` arrow glyph — a web-link idiom on a game start.
- `Sound on/off` and `Pause Esc` buttons in the corners during play — keys do this; the pause card names them.

## Sources

1. https://twistedvoxel.com/ghost-of-tsushima-title-screen-secret/ · https://gamerant.com/ghost-of-tsushima-main-menu-screen/
2. https://kotaku.com/ghost-of-tsushima-devs-slowed-down-load-times-so-you-co-1844409624 · https://www.psu.com/news/ghost-of-tsushima-directors-cut-ps5-removes-loading-screens-takes-2-seconds-to-start-up-or-use-fast-travel/
3. https://halfglassgaming.com/2020/07/the-mission-title-cards-in-ghost-of-tsushima-are-perfection/
4. https://gamefaqs.gamespot.com/ps4/226261-ghost-of-tsushima/faqs/81328/prologue-tutorial · https://ghostfranchise.fandom.com/wiki/Standoff
5. https://noisypixel.net/ghost-of-yotei-review/ · https://techraptor.net/gaming/reviews/ghost-of-yotei-review-new-ghost-in-familiar-tale · https://www.sportskeeda.com/esports/how-start-win-standoffs-ghost-yotei
6. https://www.gamesradar.com/games/open-world/reducing-the-burden-of-open-world-games-ghost-of-yotei-replaces-ghost-of-tsushimas-journal-menu-with-a-wolf-pack-of-important-characters-that-meet-you-under-the-stars-the-game-comes-to-you/
7. https://sekiroshadowsdietwice.wiki.fextralife.com/Ashina+Reservoir · https://sekiroshadowsdietwice.wiki.fextralife.com/resurrection
8. https://nioh.wiki.fextralife.com/Prologue · https://en.wikipedia.org/wiki/Nioh
9. https://www.ggrecon.com/reviews/trek-to-yomi-review/ · https://gamerescape.com/2022/03/18/preview-trek-to-yomi/ · https://explosionnetwork.com/trek-to-yomi-preview/
10. https://riseoftheronin.wiki.fextralife.com/Game_Progress_Route · https://vgwalkthrough.com/rise-of-the-ronin-walkthrough-begins-get-to-first-boss-fight/
11. https://www.hardcoregaming101.net/legend-of-kage-the/ · https://www.arcade-history.com/?n=the-legend-of-kage&page=detail&id=1369
12. https://www.destructoid.com/the-memory-card-45-the-birth-of-the-cutscene/ · https://en.wikipedia.org/wiki/Ninja_Gaiden_(NES_video_game)
13. https://www.hardcoregaming101.net/getsu-fuuma-den/
14. https://en.wikipedia.org/wiki/Shinobi_(1987_video_game) · https://en.wikipedia.org/wiki/Shadow_Dancer_(1989_video_game)
15. https://zeldawiki.wiki/wiki/Title_Screen · https://gamefaqs.gamespot.com/nes/587380-kid-icarus/faqs/17485
16. https://gamefaqs.gamespot.com/nes/578318-castlevania/faqs/76368/basics · https://en.wikipedia.org/wiki/Castlevania_(1986_video_game)
17. https://www.neoseeker.com/brave-musashi/faqs/39360-brave-fencer-musashiden-manual.html · https://bravefencermusashi.fandom.com/wiki/Chapter_1_Walkthrough
18. https://tvtropes.org/pmwiki/pmwiki.php/Main/AttractMode
19. https://developer.chrome.com/blog/web-audio-autoplay · https://developer.chrome.com/blog/autoplay/
20. https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API
21. https://www.gamedeveloper.com/design/game-design-rules-loading-screens

## Journey revision

Title input now fades onto free roaming on the woodland approach. The initial
chapter card is deferred until the player reaches the court. Arrival holds
movement for 4.2 seconds, including the existing cut/card/fade, before wave
one begins. Victory's Enter action is Continue, returning to exploration;
the palace double doors open on approach. Death's Enter action starts a new
journey. The starting route now extends to z=80 within a z=90 boundary.
