# Shumon (朱門) — the vermilion gate

Shumon, "the vermilion gate", is a three-to-five-minute duel game on the temple grounds at night. The repository and the Three.js scene keep the working name Temple Night; the game the player sees is Shumon, subtitle The Vermilion Gate. Enemy
fighters come through the torii in three waves. Each wave opens with a
standoff; then it is cuts, parries and dodges until the gate holds or the
player falls. Desktop, keyboard and mouse. Inspired by Ghost of Tsushima's
combat and menus; nothing is copied from it.

This file is the contract between the gameplay controller
(`templeGameplay.js`), the presentation (`TempleNightScene.tsx`,
`threeui.css`), and the world and audio modules. Change it before changing
the shape of the data.

## Run structure

| Wave | Enemies | Notes |
|---|---|---|
| 1 | 1 swordsman | standoff opener, teaches the timing |
| 2 | 1 shieldman + 1 spearman | standoff against the first, the second walks in 4 s later |
| 3 | 1 brute + 1 swordsman | standoff against the brute |

Between waves: a short `clear` phase (3 s) with a banner, health restores 30.
Victory when wave 3 is cleared. Death ends the run. `Enter` restarts from
wave 1 on either end card. Target total time 3–5 minutes.

## Controls

| Input | Action |
|---|---|
| W A S D | move; Shift to run |
| Mouse | look (pointer lock; right-drag fallback) |
| Left click / Space | cut (`SWING_TIME` .85 s). In a standoff: hold, then release |
| F (hold) | guard; a press within the parry window is a parry |
| Q | dodge roll (Roll clip, .55 s invulnerable) |
| E | draw / sheathe |
| 1 2 3 4 | stance: Stone, Water, Wind, Moon |
| Esc | pause; Enter restarts on an end card; M sound |

## Combat rules

- Player health 100. Enemy health: swordsman 80, shieldman 110, spearman 90, brute 160.
- Player cut: 34 damage in the active window (`swingT` .30–.62), reach 1.9 m,
  ±50° of facing. Stance multiplier: the matching stance (Stone→swordsman,
  Water→shieldman, Wind→spearman, Moon→brute) ×1.6 damage and the hit
  staggers; any other stance ×1.0; a shieldman blocks non-Water cuts 50 % of
  the time.
- Enemy attack: telegraph .6 s (raised blade, a tell), strike (hit frame at
  .15 s into the strike), recovery .8 s. Damage 22 (brute 38). Only one
  enemy attacks at a time (a shared token); the others circle at 2.4–3.2 m.
- Parry: an F press in the .28 s before the hit frame. The enemy staggers
  1.4 s and takes double damage from the next cut. Guard (F held) halves
  damage and cancels the stagger of the player.
- Dodge: Q, .55 s of invulnerability, moves 2.2 m in the input direction
  (or backwards).
- Hit reactions: player and enemies play `Hit_Chest` (or `Hit_Head` on a
  parry stagger). Death: `Death01`, body fades after 2.5 s.

## Weapons and stance motion

Enemy equipment is attached to the same skinned fighter rigs: swordsmen carry
katanas, shieldmen carry a katana and iron-rimmed plank shield, spearmen carry
a long yari, and brutes carry a studded kanabo. Pole weapons stay in hand
through the standoff and do not show a sword scabbard. Spearmen thrust toward
the player; shieldmen keep the shield raised; brutes put their weight into the cut.

The four player cuts retain the Quaternius animation as their base. Stone uses
the direct library cut, Water reverses it into a returning cut, Wind combines
the reverse with a rising diagonal, and Moon adds a broad torso sweep. These
are directional adaptations of the existing clip, not four new captured clips.
The blade paths differ inside the shared damage window; stance bonuses and
cut timing remain as specified above.

## Standoff

At the start of every wave the lead enemy stops 6 m from the player, both
sheathed, letterboxed. Prompt: hold Space. After a random 1.6–4.2 s the
enemy flinches (a visible twitch and a sound cue). Release within .28 s
after the flinch → `perfect`: the player draws and kills in one cut. Release
before the flinch → `early`: the player takes 22 damage and the fight
starts. Not releasing within .9 s after the flinch → `late`: the enemy
strikes first for 22, then the fight starts. The player may also skip the
standoff by moving.

## State contract

`gameplay.subscribe(fn)` receives, and `gameplay.getState()` returns, an
object with at least:

```ts
{
  active: boolean,            // simulation running (not paused, not on the title)
  phase: 'title' | 'standoff' | 'fight' | 'clear' | 'dead' | 'victory',
  wave: number,               // 1-based; 0 before the first wave
  waves: number,              // 3
  health: number, maxHealth: number,
  hitFlash: number,           // 0..1, decays over .5 s after the player is hit
  guarding: boolean, parryWindow: boolean, dodging: boolean,
  drawn: boolean, stance: 'stone'|'water'|'wind'|'moon',
  enemies: Array<{ id: number, type: 'swordsman'|'shieldman'|'spearman'|'brute',
                   health: number, maxHealth: number, alive: boolean,
                   attacking: boolean, staggered: boolean, distance: number }>,
  target: number | null,      // id of the nearest living enemy
  standoff: null | { holding: boolean, flinched: boolean, result: null|'perfect'|'early'|'late' },
  banner: null | { text: string, kind: 'wave'|'hint'|'result', until: number },
  result: null | { won: boolean, kills: number, seconds: number, perfect: number },
  seconds: number,            // run time
  sound: boolean, body: string, motion: string, fps: number
}
```

`subscribe` supports several listeners. Methods: `start()`, `pause()`,
`restart()`, `attack()`, `holdStandoff(down: boolean)`, `guard(down: boolean)`,
`parry()`, `dodge()`, `toggleSword()`, `setStance(name)`, `setKey()`,
`toggleSound()`, `getState()`, `dispose()`.

## Audio contract (`templeAudio.js`)

Existing: `setEnabled`, `setActive`, `update(wind)`, `step(stone, run)`,
`sword()`, `draw()`. Added, each a synthesised one-shot or bed:
`hit()`, `parry()`, `guard()`, `stagger()`, `death()`, `flinch()`,
`standoffDrum(start: boolean)`, `bell()` (wave start), `victory()`,
`ambience({ rain, insects })` per-frame levels. Gameplay calls them
optional-chained so a missing method never throws.

## Presentation contract

Reference: Ghost of Tsushima's menus. Black, off-white brush-ink type, thin
rules, one red seal, letterbox bars in standoffs, a HUD that fades when
nothing is happening. Fonts are self-hosted OFL files under `public/fonts`.
Surfaces: title (with controls and a Begin button), HUD (health rule,
stance glyphs 石 水 風 月, wave counter, target health), standoff prompt,
banners, damage vignette, pause, death card, victory card with kills,
time and perfect standoffs. Every string lives in one place
(`src/shaders/temple-night/copy.ts`).

## Environment pass

`templeEnvironment.js` owns the foreground composition and material overrides;
the generated renderer calls it only through its game extension hooks. The
court uses weathered paving with broad damp patches; finite, feathered puddles
own the small rain rings. Grain and bloom are reduced. Ground sits farther
below the paving to avoid nearly coincident surfaces. The surrounding soil
has broad moss variation and grass grows in clumps with bare pockets.

A fixed set of branching trees, exposed roots, leaf litter, weathered rock
formations and broken edging frames the open fighting lane. Nearby rocks use
smoother normals; new formations have varied profiles and moss-tinted tops.
Contact shading follows the terrain and lantern falloff stays close to the
lamps. Leaves are instanced and the low preset reduces canopy/litter density.
All geometry and textures are generated locally; there are no new downloads.

Returning to title clears the enemy pool, hides the player, and resets camera,
stance, and physics to the starting view. Restart also resets the physical
spawn instead of retaining the previous run's position.
