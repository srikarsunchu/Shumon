/* Every user-facing string for Shumon lives here. The scene reads from this
   file only; nothing in the JSX carries prose of its own. The game is Shumon
   (朱門, the vermilion gate); the repository keeps the working name Temple
   Night in identifiers and class names. */

export type StanceName = "stone" | "water" | "wind" | "moon";
export type EnemyType = "swordsman" | "shieldman" | "spearman" | "brute";

/* The entry sequence, docs/INTRO.md §3. Caps for cards and hints; no
   welcome; no explanation of who the player is or why enemies come; a kanji
   is never the only carrier of a meaning. */
export const intro = {
  brand: { mark: "朱", name: "SHUMON" },
  loading: { body: "THE BODY", forms: "THE FORMS", ground: "THE GROUND", ink: "THE INK" },
  title: { kanji: "朱門", name: "SHUMON", subtitle: "THE VERMILION GATE", prompt: "PRESS ANY KEY" },
  chapter: {
    night: "NIGHT ONE",
    waves: [
      { numeral: "一", name: "THE GATE" },
      { numeral: "二", name: "SHIELD AND SPEAR" },
      { numeral: "三", name: "THE BRUTE" },
    ],
  },
  hint: {
    standoff: "HOLD SPACE",
    parry: "F — PARRY",
    look: "RIGHT-DRAG TO LOOK",
  },
  result: { perfect: "ONE CUT", early: "TOO SOON", late: "TOO LATE" },
  banner: { clear: "THE GATE HOLDS" },
  pause: {
    title: "PAUSED",
    resume: "CLICK TO RESUME",
    controls: [
      ["W A S D", "Move"], ["Shift", "Run"], ["Mouse", "Look"],
      ["Click / Space", "Cut"], ["F", "Guard · Parry"], ["Q", "Dodge"],
      ["E", "Draw · Sheathe"], ["1 2 3 4", "石 水 風 月"], ["M", "Sound"],
    ],
  },
  death: { title: "THE GATE FALLS", stats: (w: number, t: string) => `wave ${w} · ${t}` },
  victory: { title: "THE NIGHT PASSES", stats: (w: number, t: string, p: number) => `${w} waves · ${t} · ${p} perfect` },
  endcard: { continue: "ENTER — CONTINUE", again: "ENTER — AGAIN", title: "ESC — TITLE" },
  sound: { on: "SOUND ON", off: "SOUND OFF" },
  unavailable: (why: string) => `The night could not load: ${why || "unsupported context"}.`,
} as const;

export const copy = {
  ...intro,

  hud: {
    wave: (wave: number, waves: number) => `Wave ${wave} of ${waves}`,
    waveLabel: "Wave",
    health: "Health",
    stance: "Stance",
  },

  stances: {
    stone: { glyph: "石", name: "Stone", key: "1", beats: "swordsman" },
    water: { glyph: "水", name: "Water", key: "2", beats: "shieldman" },
    wind: { glyph: "風", name: "Wind", key: "3", beats: "spearman" },
    moon: { glyph: "月", name: "Moon", key: "4", beats: "brute" },
  } as Record<StanceName, { glyph: string; name: string; key: string; beats: EnemyType }>,

  enemies: {
    swordsman: "Swordsman",
    shieldman: "Shieldman",
    spearman: "Spearman",
    brute: "Brute",
  } as Record<EnemyType, string>,

  canvasLabel: "Shumon, The Vermilion Gate: a night duel on the temple grounds",
  touch: {
    swing: "Cut",
    move: (dir: string) => `Move ${dir}`,
  },
} as const;

export const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
