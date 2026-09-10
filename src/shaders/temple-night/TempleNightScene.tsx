import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { registerGameTools } from "./templeAgentControls.js";
import { createTempleGameplay } from "./templeGameplay.js";
import { createTempleNightRenderer } from "./templeNightRenderer.js";
import { copy, formatTime, type EnemyType, type StanceName } from "./copy";

/* In the original library this scene also fronted three sibling worlds
   (yosemite-sunset, presidio-sunset, lake-louise) as lazily loaded variants.
   Those renderers are not part of this repo, so only the temple world is
   wired up; the prop is kept so the call site reads the same. */
export type TempleNightVariant = "temple-night";

export type TempleNightSceneProps = {
  className?: string;
  variant?: TempleNightVariant;
};

/* The state shape from docs/GAME.md. Every field is optional here because
   the gameplay track lands in pieces; the UI degrades to the pre-contract
   behaviour (title ↔ playing) when a field is missing. */
type Phase = "roam" | "arrival" | "title" | "standoff" | "fight" | "clear" | "dead" | "victory";
type Enemy = { id: number; type: EnemyType; health: number; maxHealth: number; alive: boolean; attacking?: boolean; staggered?: boolean; distance?: number };
export type GameStatus = {
  active?: boolean;
  phase?: Phase;
  wave?: number;
  waves?: number;
  health?: number;
  maxHealth?: number;
  hitFlash?: number;
  guarding?: boolean;
  parryWindow?: boolean;
  dodging?: boolean;
  drawn?: boolean;
  stance?: StanceName | string;
  enemies?: Enemy[];
  target?: number | null;
  standoff?: null | { holding?: boolean; flinched?: boolean; result?: null | "perfect" | "early" | "late" };
  banner?: null | { text: string; kind?: "wave" | "hint" | "result"; until?: number };
  result?: null | { won?: boolean; kills?: number; seconds?: number; perfect?: number };
  seconds?: number;
  sound?: boolean;
};

/* The methods the UI calls. All optional-chained at the call site so a
   half-built gameplay module never throws inside a key handler. */
type Gameplay = {
  start?: (options?: { restart?: boolean }) => void;
  pause?: () => void;
  returnToTitle?: () => void;
  continueExploring?: () => void;
  restart?: (options?: { restart?: boolean }) => void;
  attack?: () => void;
  holdStandoff?: (down: boolean) => void;
  guard?: (down: boolean) => void;
  parry?: () => void;
  dodge?: () => void;
  toggleSound?: () => void;
  look?: (horizontal: number, vertical?: number) => void;
  setKey?: (key: string, pressed: boolean) => void;
  subscribe?: (fn: (status: GameStatus) => void) => void;
  getState?: () => GameStatus;
  ready?: Promise<unknown>;
  animationReady?: Promise<unknown>;
  bodyReady?: Promise<unknown>;
  clipsReady?: Promise<unknown>;
};

export function TempleNightScene({ className = "" }: TempleNightSceneProps) {
  return <TempleNightWorld className={className} />;
}

/* ---- the entry sequence (docs/INTRO.md §2) ---------------------------- */

/* boot: black. loading: the stroke at real progress. reveal: stroke done,
   canvas fades in behind it. title: over the live scene. cut: 250 ms to
   black on the gesture. chapter: the card on black. fade: black lifts onto
   the game. play: the run. dying: slow desaturation, then black. death /
   victory: the end cards on black. won: the hold on the body before the
   victory card. toTitle: the 400 ms return from an end card. */
type Mode = "boot" | "loading" | "reveal" | "title" | "cut" | "chapter" | "fade" | "play" | "dying" | "death" | "won" | "victory" | "toTitle";
type Hint = "standoff" | "parry" | "look";
type StageKey = "body" | "forms" | "ground" | "ink";

/* Dev-only mock shape: window.__templeNightMock({ phase, ..., ui: { mode,
   progress, stage, hint, card } }) or ?mock=<json>. `ui` drives the entry
   sequence directly; the rest merges into the gameplay status. */
type MockUi = { mode?: Mode; progress?: number; stage?: StageKey; hint?: Hint | null; card?: number | null; cardOut?: boolean };
type Mock = GameStatus & { ui?: MockUi };

/* The beat timings, in ms. Motion durations live in threeui.css; these are
   the holds between them. */
const T = {
  boot: 400,            /* black before the stroke appears */
  loadMin: 900,         /* the stroke is on screen at least this long */
  reveal: 900,          /* canvas fades in behind the finished stroke */
  prompt: 800,          /* PRESS ANY KEY after the title */
  cut: 250,             /* title → black, a cut */
  chapterFirst: 2950,   /* card hold on a first run (t0+0.25 → t0+3.2) */
  chapterAgain: 1600,   /* card hold on a restart */
  chapterSkip: 1200,    /* any key skips the card after this */
  cardOut: 500,         /* card slides 12 px and fades */
  fade: 900,            /* black → scene */
  waveCard: 1600,       /* 二 / 三 in-world cards */
  result: 1200,         /* ONE CUT / TOO SOON / TOO LATE */
  parryHint: 900,       /* the tell is .6 s; the line stays legible a touch longer */
  lookHint: 3000,       /* RIGHT-DRAG TO LOOK when pointer lock was refused */
  soundLine: 1200,      /* SOUND ON / OFF after M */
  dying: 1200,          /* hit that kills → black (desaturation runs 600 ms inside it) */
  victoryHold: 1500,    /* hold on the last body, letterbox in */
  endIdle: 30000,       /* idle on an end card → title */
  hiddenIdle: 60000,    /* tab hidden while paused → title */
  toTitle: 400,
  hudIdle: 4000,        /* HUD rests after this with nothing happening */
  stancePulse: 600,
};

/* Loading weights (docs/INTRO.md §4). The loaders live inside the gameplay
   module and expose promises, not byte counts, so each item is 0 until it
   resolves; the follower turns the steps into a stroke. */
const LOAD_PARTS: Array<{ key: string; stage: StageKey | null; weight: number }> = [
  { key: "body", stage: "body", weight: .45 },
  { key: "anim", stage: "forms", weight: .25 },
  { key: "clips", stage: "forms", weight: .05 },
  { key: "ground", stage: "ground", weight: .12 },
  { key: "ink", stage: "ink", weight: .05 },
  { key: "warm", stage: null, weight: .08 },
];
const FONT_LOADS = ['500 16px "Cormorant Garamond"', 'italic 400 16px "Cormorant Garamond"', "400 13px Jost", '500 16px "Noto Serif JP"'];
const STROKE_LENGTH = 520;
const SWAY_PERIOD_MS = 14000;
const SWAY_RAD = 2 * Math.PI / 180;

const STANCES: StanceName[] = ["stone", "water", "wind", "moon"];
const MODIFIER_KEYS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock", "Tab", "Escape"]);

/* A stable fingerprint of what the HUD shows; when it changes the HUD wakes. */
const hudSignature = (s: GameStatus) =>
  [s.health, s.stance, s.wave, s.target, s.guarding, s.parryWindow, s.dodging, s.drawn, (s.hitFlash ?? 0) > 0,
    s.enemies?.map(e => `${e.id}:${e.health}:${e.alive ? 1 : 0}:${e.attacking ? 1 : 0}`).join(",")].join("|");

function TempleNightWorld({ className = "" }: { className?: string }) {
  const gameRef = useRef<Gameplay | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<SVGPathElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [live, setLive] = useState<GameStatus>({});
  const [mock, setMock] = useState<Mock | null>(null);
  const reduced = useReducedMotion();

  const status = useMemo<GameStatus>(() => {
    if (!mock) return live;
    const { ui: _ui, ...rest } = mock;
    return { ...live, ...rest };
  }, [live, mock]);
  const statusRef = useRef(status);
  statusRef.current = status;

  /* ---- the machine ---- */
  const [machine, setMachine] = useState<Mode>("boot");
  const mode: Mode = mock?.ui?.mode ?? machine;
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const [stage, setStage] = useState<StageKey>("body");
  const [promptOn, setPromptOn] = useState(false);
  const [cardOut, setCardOut] = useState(false);
  const [waveCard, setWaveCard] = useState<number | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [soundLine, setSoundLine] = useState<string | null>(null);
  const [pulse, setPulse] = useState<StanceName | null>(null);
  const [fightReached, setFightReached] = useState(false);
  const timers = useRef<number[]>([]);
  const after = useCallback((ms: number, fn: () => void) => { const id = window.setTimeout(fn, ms); timers.current.push(id); return id; }, []);
  const clearTimers = useCallback(() => { timers.current.forEach(id => window.clearTimeout(id)); timers.current = []; }, []);

  /* what survives across runs */
  const firstRun = useRef(true);
  const soundDecided = useRef(false);
  const standoffWon = useRef(false);
  const lockRefused = useRef(false);
  const lookHintShown = useRef(false);
  const chapterAt = useRef(0);
  /* per run */
  const parryShown = useRef(false);
  const lastCardWave = useRef(0);
  const seenTypes = useRef<Set<string>>(new Set());
  const hintSuppressed = useRef(false);

  /* loading progress: weighted parts, a never-decreasing follower */
  const load = useRef({ parts: Object.fromEntries(LOAD_PARTS.map(p => [p.key, 0])) as Record<string, number>, shown: 0, since: 0 });
  const readyRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    let unregisterTools = () => {};
    let ready = false;
    let mounted = true;
    let renderer: ReturnType<typeof createTempleNightRenderer>;
    const parts = load.current.parts;
    const settle = (key: string, p?: Promise<unknown>) => Promise.resolve(p).catch(() => undefined).then(() => { if (mounted) parts[key] = 1; });
    try {
      renderer = createTempleNightRenderer(canvas, createTempleGameplay);
      const gameplay = renderer.gameplay as Gameplay | undefined;
      gameRef.current = gameplay ?? null;
      unregisterTools = registerGameTools(renderer.gameplay);
      /* Everything is kicked off inside the gameplay module at mount; here
         the promises are only watched. The skinned body and the pose clips
         settle their own failures (the procedural rig stays), so waiting on
         them can never fail the world; a missing promise counts as done. */
      settle("body", gameplay?.bodyReady);
      settle("anim", gameplay?.animationReady);
      settle("clips", gameplay?.clipsReady);
      settle("ground", gameplay?.ready);
      /* the ink: the three faces (four files) from public/fonts */
      const fonts = typeof document !== "undefined" && document.fonts ? FONT_LOADS.map(f => document.fonts.load(f).catch(() => undefined)) : [];
      let inked = 0;
      if (!fonts.length) parts.ink = 1;
      fonts.forEach(p => p.then(() => { inked++; if (mounted) parts.ink = inked / fonts.length; }));
      const optional = (p?: Promise<unknown>) => Promise.resolve(p).catch(() => undefined);
      Promise.all([gameplay?.ready, gameplay?.animationReady, optional(gameplay?.bodyReady), optional(gameplay?.clipsReady), ...fonts]).then(() => { if (mounted) ready = true; }).catch(error => {
        if (mounted) { setErrorMessage(error instanceof Error ? error.message : "World initialization failed"); setState("unavailable"); }
      });
      gameplay?.subscribe?.((next: GameStatus) => { if (mounted) setLive({ ...next }); });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown renderer error");
      setState("unavailable");
      return undefined;
    }
    if (!renderer) {
      setState("unavailable");
      return undefined;
    }

    let frame = 0;
    let visible = true;
    let disposed = false;
    let rendered = false;

    const schedule = () => {
      if (!disposed && visible && !document.hidden && !frame) {
        frame = requestAnimationFrame(render);
      }
    };
    const render = (time: number) => {
      frame = 0;
      renderer.render(time);
      /* warm: one frame drawn with everything resolved */
      if (!rendered && ready) {
        rendered = true;
        parts.warm = 1;
        readyRef.current = true;
        setState("ready");
      }
      if (!renderer.reducedMotion) schedule();
    };
    /* The renderer measures the canvas's own clientWidth/Height, and its
       setSize writes that measurement back as an inline pixel style. Left
       alone, the second resize reads the pinned inline size instead of the
       host, so the canvas never follows a viewport change (and if the host
       was zero-sized at mount, it stays 1×1 forever). Dropping the inline
       size first lets the stylesheet's 100% rule report the host's size. */
    const resize = () => {
      canvas.style.width = "";
      canvas.style.height = "";
      renderer.resize();
      schedule();
    };
    const setPointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      const y = 1 - ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2;
      renderer.setPointer(x, y, true);
      schedule();
    };
    const clearPointer = () => {
      renderer.setPointer(0, 0, false);
      schedule();
    };
    const onVisibility = () => {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        schedule();
      }
    };
    const onLockError = () => { lockRefused.current = true; };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        schedule();
      }
    });
    intersectionObserver.observe(host);
    canvas.addEventListener("pointermove", setPointer, { passive: true });
    canvas.addEventListener("pointerenter", setPointer, { passive: true });
    canvas.addEventListener("pointerleave", clearPointer, { passive: true });
    window.addEventListener("blur", clearPointer);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerlockerror", onLockError);
    resize();

    return () => {
      unregisterTools();
      mounted = false;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("pointermove", setPointer);
      canvas.removeEventListener("pointerenter", setPointer);
      canvas.removeEventListener("pointerleave", clearPointer);
      window.removeEventListener("blur", clearPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerlockerror", onLockError);
      renderer.dispose();
      gameRef.current = null;
    };
  }, []);

  /* Dev-only: lets a session set presentation state without the gameplay
     track (window.__templeNightMock({ phase: 'standoff', ui: { mode: 'play' } });
     null clears). */
  useEffect(() => {
    if (!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return undefined;
    const w = window as unknown as { __templeNightMock?: (s: Mock | null) => void };
    w.__templeNightMock = (s) => setMock(s);
    /* ?mock=<json> applies one on load, for headless captures */
    try {
      const q = new URLSearchParams(location.search).get("mock");
      if (q) setMock(JSON.parse(q) as Mock);
    } catch { /* ignore a malformed mock */ }
    return () => { delete w.__templeNightMock; };
  }, []);

  /* ---- timed beats: each mode schedules the next ---- */
  useEffect(() => {
    clearTimers();
    switch (machine) {
      case "boot":
        after(T.boot, () => { load.current.since = performance.now(); setMachine("loading"); });
        break;
      case "reveal":
        after(T.reveal, () => setMachine("title"));
        break;
      case "title":
        setPromptOn(false);
        after(T.prompt, () => setPromptOn(true));
        break;
      case "cut":
        after(T.cut, () => { chapterAt.current = performance.now(); setCardOut(false); setMachine("chapter"); });
        break;
      case "chapter": {
        const hold = firstRun.current ? T.chapterFirst : T.chapterAgain;
        after(hold - T.cardOut, () => setCardOut(true));
        after(hold, () => setMachine("fade"));
        break;
      }
      case "fade":
        after(T.fade, () => setMachine("play"));
        break;
      case "dying":
        after(T.dying, () => setMachine("death"));
        break;
      case "won":
        after(T.victoryHold + T.fade, () => setMachine("victory"));
        break;
      case "toTitle":
        after(T.toTitle, () => setMachine("title"));
        break;
      default:
        break;
    }
    return clearTimers;
  }, [machine, after, clearTimers]);

  /* ---- loading: the follower draws the stroke ---- */
  const mockProgress = mock?.ui?.progress;
  useEffect(() => {
    if (machine !== "loading") return undefined;
    let frame = 0;
    let last = performance.now();
    let lastStage: StageKey | null = null;
    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(.1, (now - last) / 1000);
      last = now;
      const l = load.current;
      const progress = LOAD_PARTS.reduce((sum, p) => sum + p.weight * Math.min(1, l.parts[p.key]), 0);
      const complete = LOAD_PARTS.every(p => l.parts[p.key] >= 1);
      if (mockProgress != null) l.shown = clamp01(mockProgress);
      else {
        const next = l.shown + (progress - l.shown) * Math.min(1, dt * 6);
        l.shown = Math.max(l.shown, complete && next > .995 ? 1 : next);
      }
      if (strokeRef.current) strokeRef.current.style.strokeDashoffset = `${(1 - l.shown) * STROKE_LENGTH}`;
      /* stage label: the heaviest unresolved item */
      const remaining: Record<StageKey, number> = { body: 0, forms: 0, ground: 0, ink: 0 };
      LOAD_PARTS.forEach(p => { if (p.stage && l.parts[p.key] < 1) remaining[p.stage] += p.weight; });
      const heaviest = (Object.keys(remaining) as StageKey[]).reduce<StageKey | null>((best, k) => remaining[k] > 0 && (best == null || remaining[k] > remaining[best]) ? k : best, null);
      const shownStage = mock?.ui?.stage ?? heaviest ?? lastStage;
      if (shownStage && shownStage !== lastStage) { lastStage = shownStage; setStage(shownStage); }
      if (mockProgress == null && l.shown >= 1 && readyRef.current && now - l.since >= T.loadMin) {
        setMachine("reveal");
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { if (frame) cancelAnimationFrame(frame); };
  }, [machine, mockProgress, mock?.ui?.stage]);

  /* ---- the gesture ---- */
  const begin = useCallback(() => {
    const game = gameRef.current;
    const canvas = canvasRef.current;
    if (!game || !readyRef.current) return;
    /* the spec's beat 5 starts the audio on the gesture; a sound choice the
       player already made (M) is left alone */
    if (!soundDecided.current) { soundDecided.current = true; if (!statusRef.current.sound) game.toggleSound?.(); }
    lockRefused.current = false;
    game.start?.({ restart: true });
    /* the cut is honest only if the run actually began (start() refuses
       until physics is up, and a mock has no controller behind it) */
    const now = game.getState?.();
    if (now && (now.phase === "title" || now.phase === "dead" || now.phase === "victory")) return;
    window.setTimeout(() => { if (canvas && document.pointerLockElement !== canvas) lockRefused.current = true; }, 400);
    parryShown.current = false;
    lastCardWave.current = 0;
    seenTypes.current = new Set();
    /* on a restart no hints unless the standoff was never won */
    hintSuppressed.current = !firstRun.current && standoffWon.current;
    setFightReached(false);
    setWaveCard(null);
    setHint(null);
    setMachine(now?.phase === "roam" ? "fade" : "cut");
  }, []);

  const again = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    firstRun.current = false;
    begin();
  }, [begin]);

  const continueJourney = useCallback(() => { gameRef.current?.continueExploring?.(); setMachine("fade"); }, []);

  const toTitle = useCallback(() => {
    gameRef.current?.returnToTitle?.();
    setHint(null);
    setWaveCard(null);
    setMachine("toTitle");
  }, []);

  const flashSound = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    soundDecided.current = true;
    const next = !statusRef.current.sound;
    game.toggleSound?.();
    setSoundLine(next ? copy.sound.on : copy.sound.off);
  }, []);
  const soundLineShown = useHeld(soundLine, T.soundLine);

  /* title: any key or click begins; M toggles sound */
  useEffect(() => {
    if (mode !== "title") return undefined;
    const host = hostRef.current;
    const go = () => { firstRun.current = true; begin(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || MODIFIER_KEYS.has(e.code) || /^F\d+$/.test(e.code)) return;
      if (e.code === "KeyM") { flashSound(); return; }
      go();
    };
    const onPointer = (e: PointerEvent) => { if (e.button === 0) go(); };
    window.addEventListener("keydown", onKey);
    host?.addEventListener("pointerdown", onPointer);
    return () => { window.removeEventListener("keydown", onKey); host?.removeEventListener("pointerdown", onPointer); };
  }, [mode, begin, flashSound]);

  /* attract: a slow look sway, 2° over 14 s, ping-pong, only through what the host offers */
  useEffect(() => {
    if (mode !== "title" || reduced) return undefined;
    const game = gameRef.current;
    if (!game?.look) return undefined;
    let frame = 0;
    let prev = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const yaw = Math.sin(((now - start) / SWAY_PERIOD_MS) * Math.PI * 2) * SWAY_RAD;
      game.look?.(yaw - prev, 0);
      prev = yaw;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, reduced]);

  /* chapter card: any key skips after 1.2 s */
  useEffect(() => {
    if (machine !== "chapter") return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || MODIFIER_KEYS.has(e.code) || cardOut) return;
      if (performance.now() - chapterAt.current < T.chapterSkip) return;
      clearTimers();
      setCardOut(true);
      after(T.cardOut, () => setMachine("fade"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [machine, cardOut, after, clearTimers]);

  /* ---- in play: what the contract's state means on screen ---- */
  const phase: Phase = status.phase ?? (status.active ? "fight" : "title");
  const inPlay = mode === "play";
  const paused = inPlay && status.active === false && (phase === "roam" || phase === "arrival" || phase === "standoff" || phase === "fight" || phase === "clear");
  const wave = status.wave ?? 0;
  const waves = status.waves ?? 3;

  /* a controller that reports 'title' mid-run has been replaced under us
     (dev hot reload); the only honest place for the UI is the title */
  const livePhase = live.phase;
  useEffect(() => {
    const m = machineRef.current;
    if (livePhase === "title" && (m === "cut" || m === "chapter" || m === "fade" || m === "play" || m === "dying" || m === "won")) { clearTimers(); setMachine("title"); }
  }, [livePhase, clearTimers]);

  useEffect(() => { if(phase === "arrival") setMachine("cut"); }, [phase]);

  /* death and victory beats */
  useEffect(() => {
    if (machineRef.current !== "play") return;
    if (phase === "dead") setMachine("dying");
    if (phase === "victory") setMachine("won");
  }, [phase]);

  /* end cards: Enter again, Esc or 30 s idle → title; M still toggles sound */
  useEffect(() => {
    if (mode !== "death" && mode !== "victory") return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Enter") { e.preventDefault(); if(mode === "victory") continueJourney(); else again(); }
      else if (e.code === "Escape") toTitle();
      else if (e.code === "KeyM") flashSound();
    };
    window.addEventListener("keydown", onKey);
    const idle = window.setTimeout(toTitle, T.endIdle);
    return () => { window.removeEventListener("keydown", onKey); window.clearTimeout(idle); };
  }, [mode, again, continueJourney, toTitle, flashSound]);

  /* pause: a click (or Enter) is the gesture pointer lock needs; a tab hidden
     for a minute while paused returns to the title */
  const resume = useCallback(() => { gameRef.current?.start?.(); }, []);
  useEffect(() => {
    if (!paused) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Enter") { e.preventDefault(); resume(); }
      else if (e.code === "KeyM") flashSound();
    };
    let hiddenTimer = 0;
    const onVisibility = () => {
      window.clearTimeout(hiddenTimer);
      if (document.hidden) hiddenTimer = window.setTimeout(toTitle, T.hiddenIdle);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("visibilitychange", onVisibility); window.clearTimeout(hiddenTimer); };
  }, [paused, resume, toTitle, flashSound]);

  /* M in play (the gameplay toggles; the line is ours) */
  useEffect(() => {
    if (!inPlay || paused) return undefined;
    const onKey = (e: KeyboardEvent) => { if (!e.repeat && e.code === "KeyM") setSoundLine(statusRef.current.sound ? copy.sound.off : copy.sound.on); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inPlay, paused]);

  /* the HUD draws in at the first fight of the run */
  useEffect(() => { if (inPlay && phase === "fight") setFightReached(true); }, [inPlay, phase]);

  /* wave cards: keyed on the wave number, so the clear → standoff transition
     and a controller banner of kind 'wave' cannot double-show */
  const bannerKind = status.banner?.kind;
  useEffect(() => {
    if (!inPlay || phase !== "standoff" || wave < 2) return;
    if (lastCardWave.current === wave) return;
    lastCardWave.current = wave;
    setWaveCard(wave);
  }, [inPlay, phase, wave, bannerKind]);
  const waveCardShown = useHeld(waveCard, T.waveCard);

  /* the stance lesson: the matching glyph pulses once when a new type steps through */
  const typesKey = status.enemies?.filter(e => e.alive).map(e => e.type).join(",") ?? "";
  useEffect(() => {
    if (!inPlay || wave < 2 || !typesKey) return;
    const fresh = typesKey.split(",").find(t => !seenTypes.current.has(t));
    typesKey.split(",").forEach(t => seenTypes.current.add(t));
    if (!fresh) return;
    const s = STANCES.find(k => copy.stances[k].beats === fresh) ?? null;
    if (s) setPulse(s);
  }, [inPlay, wave, typesKey]);
  const pulseShown = useHeld(pulse, T.stancePulse);

  /* standoff results, once per resolution */
  const standoffResult = status.standoff?.result ?? null;
  useEffect(() => { if (standoffResult === "perfect") standoffWon.current = true; }, [standoffResult]);
  const resultShown = useHeld(inPlay ? standoffResult : null, T.result);

  /* hints: HOLD SPACE (wave 1, the enemy stopped, nothing held), F — PARRY on
     the first telegraph of wave 1, RIGHT-DRAG TO LOOK when lock was refused */
  const lead = status.enemies?.find(e => e.alive) ?? null;
  const enemyStopped = lead ? lead.distance == null || lead.distance <= 6.6 : true;
  const standoffHint = inPlay && !paused && phase === "standoff" && !!status.standoff && !status.standoff.holding && !status.standoff.result && wave === 1 && enemyStopped && !standoffWon.current && !hintSuppressed.current;
  const telegraph = !!status.enemies?.some(e => e.alive && e.attacking);
  useEffect(() => {
    if (!inPlay || phase !== "fight" || wave !== 1 || !telegraph || parryShown.current || hintSuppressed.current) return;
    parryShown.current = true;
    setHint("parry");
  }, [inPlay, phase, wave, telegraph]);
  useEffect(() => {
    if (machine !== "play" || !lockRefused.current || lookHintShown.current) return;
    lookHintShown.current = true;
    setHint("look");
  }, [machine]);
  /* a timed hint expires on its own; only a different hint re-arms the clock */
  const timedHint = useHeld(hint, hint === "look" ? T.lookHint : T.parryHint);
  const shownHint: Hint | null = mock?.ui?.hint !== undefined ? mock.ui.hint : timedHint ?? (standoffHint ? "standoff" : null);

  const hudOn = inPlay && !paused && fightReached && (phase === "fight" || phase === "clear");
  const awake = useHudAwake(status, hudOn);

  const stance = (STANCES.includes(status.stance as StanceName) ? status.stance : "stone") as StanceName;
  const target = status.enemies?.find(e => e.id === status.target && e.alive) ?? null;
  const wantedStance = target ? STANCES.find(s => copy.stances[s].beats === target.type) ?? null : null;
  const health = clamp01((status.health ?? 100) / (status.maxHealth ?? 100));
  const hitFlash = inPlay ? clamp01(status.hitFlash ?? 0) : 0;
  const letterbox = (phase === "standoff" && (mode === "chapter" || mode === "fade" || mode === "play")) || mode === "won";
  const black: "on" | "off" = mode === "boot" || mode === "loading" || mode === "cut" || mode === "chapter" || mode === "dying" || mode === "death" || mode === "won" || mode === "victory" ? "on" : "off";
  const brandOn = mode === "title" || mode === "toTitle" || mode === "death" || mode === "victory" || paused;
  const card = mock?.ui?.card ?? waveCardShown;
  const chapter = copy.chapter.waves[Math.min(copy.chapter.waves.length, Math.max(1, (mode === "chapter" ? wave : card) || 1)) - 1];
  const seconds = status.result?.seconds ?? status.seconds ?? 0;

  return (
    <div className={`temple-night-scene${className ? ` ${className}` : ""}`} ref={hostRef} data-state={state} data-phase={phase} data-mode={mode} data-reduced-motion={reduced ? "true" : undefined}>
      <canvas
        ref={canvasRef}
        className={`temple-night-canvas${state === "ready" ? " is-ready" : ""}${mode === "dying" || mode === "death" ? " is-dying" : ""}`}
        aria-label={copy.canvasLabel}
      />
      {state !== "unavailable" && <>
        {/* damage: a red-black vignette keyed to hitFlash */}
        <div className="tn-vignette" aria-hidden="true" style={{ opacity: hitFlash }} />

        {/* standoff letterbox */}
        <div className={`tn-letterbox tn-letterbox-top${letterbox ? " is-on" : ""}`} aria-hidden="true" />
        <div className={`tn-letterbox tn-letterbox-bottom${letterbox ? " is-on" : ""}`} aria-hidden="true" />

        {/* guard / parry: a thin ring while the window is open, rules while guarding */}
        <div className={`tn-ring${inPlay && status.parryWindow ? " is-on" : ""}`} aria-hidden="true" />
        <div className={`tn-guard${inPlay && status.guarding ? " is-on" : ""}`} aria-hidden="true" />

        {hudOn && (
          <div className={`tn-hud${awake ? " is-awake" : ""}`} aria-live="off">
            <div className="tn-hud-corner tn-hud-tr">
              <div className="tn-wave">{copy.hud.wave(Math.max(1, wave), waves)}</div>
              {target && (
                <div className="tn-target">
                  <div className="tn-rule tn-rule-target"><span style={{ transform: `scaleX(${clamp01(target.health / (target.maxHealth || 1))})` }} /></div>
                  <div className="tn-target-name">{copy.enemies[target.type] ?? target.type}</div>
                </div>
              )}
            </div>
            <div className="tn-hud-corner tn-hud-bl">
              {wave >= 2 && (
                <div className="tn-stances" role="group" aria-label={copy.hud.stance}>
                  {STANCES.map(s => (
                    <span key={s} className={`tn-stance${s === stance ? " is-active" : ""}${s === wantedStance && s !== stance ? " is-wanted" : ""}${s === pulseShown ? " is-pulse" : ""}`} lang="ja" title={`${copy.stances[s].name} · ${copy.stances[s].key}`}>{copy.stances[s].glyph}</span>
                  ))}
                </div>
              )}
              <div className="tn-health" aria-label={copy.hud.health}>
                <span className="tn-seal tn-seal-small" aria-hidden="true" />
                <div className="tn-rule tn-rule-health"><span style={{ transform: `scaleX(${health})` }} /></div>
              </div>
            </div>
          </div>
        )}

        {/* the black layer: boot, cuts, the chapter card's ground, death and victory */}
        <div className="tn-black" data-on={black} data-mode={mode} aria-hidden="true" />

        {/* the stroke: the loader, then the title's rule */}
        {(mode === "loading" || mode === "reveal" || mode === "title" || mode === "toTitle") && (
          <div className={`tn-entry${mode === "title" || mode === "toTitle" ? " is-title" : ""}${mode !== "loading" || (mockProgress != null && mockProgress >= 1) ? " is-done" : ""}`} data-prompt={promptOn || mock?.ui?.mode === "title" ? "on" : "off"}>
            <div className="tn-entry-above" lang="ja" aria-hidden={mode === "loading" ? "true" : undefined}>{copy.title.kanji}</div>
            <svg className="tn-stroke" viewBox={`0 0 ${STROKE_LENGTH} 12`} preserveAspectRatio="none" aria-hidden="true">
              <path ref={strokeRef} d={`M2 7 C 120 4, 380 9, ${STROKE_LENGTH - 2} 6`} pathLength={STROKE_LENGTH} style={{ strokeDasharray: STROKE_LENGTH, strokeDashoffset: mode === "loading" ? (1 - (mockProgress ?? load.current.shown)) * STROKE_LENGTH : 0 }} />
            </svg>
            <div className="tn-entry-below">
              <div className="tn-stage" role="status">{copy.loading[mock?.ui?.stage ?? stage]}</div>
              <h1 className="tn-title-name" lang="en">{copy.title.name}</h1>
              <div className="tn-title-sub">{copy.title.subtitle}</div>
              <div className="tn-prompt">{copy.title.prompt}</div>
            </div>
          </div>
        )}
        {mode === "loading" && <span className="tn-seal tn-seal-loader" aria-hidden="true">{copy.brand.mark}</span>}

        {brandOn && <div className="tn-brand"><span className="tn-seal" aria-hidden="true">{copy.brand.mark}</span><span className="tn-brand-name">{copy.brand.name}</span></div>}

        {/* the chapter card on black, and the in-world wave cards */}
        {(mode === "chapter" || (inPlay && card != null)) && (
          <div className={`tn-chapter${mode === "chapter" ? " is-black" : " is-world"}${(mock?.ui?.cardOut ?? cardOut) && mode === "chapter" ? " is-out" : ""}`} key={mode === "chapter" ? "chapter" : `wave-${card}`} style={{ "--hold": `${mode === "chapter" ? (firstRun.current ? T.chapterFirst : T.chapterAgain) : T.waveCard}ms` } as CSSProperties}>
            <div className="tn-chapter-body">
              <div className="tn-chapter-numeral" lang="ja">{chapter.numeral}</div>
              <h2 className="tn-chapter-title">{chapter.name}</h2>
              {mode === "chapter" && <>
                <div className="tn-hair" aria-hidden="true" />
                <div className="tn-chapter-night">{copy.chapter.night}</div>
              </>}
            </div>
          </div>
        )}

        {/* the clear banner */}
        <div className={`tn-banner${inPlay && phase === "clear" ? " is-on" : ""}`} role="status">{copy.banner.clear}</div>

        {/* standoff result line */}
        {inPlay && resultShown && <div className="tn-result" key={resultShown}>{copy.result[resultShown]}</div>}

        {/* one hint at a time, under the lower bar; a rule, never a box */}
        {(shownHint || soundLineShown) && (inPlay || mode === "title" || mode === "death" || mode === "victory") && (
          <div className="tn-hint" key={shownHint ?? soundLineShown ?? ""} role="status">
            <span className="tn-hint-rule" aria-hidden="true" />
            <span>{shownHint ? copy.hint[shownHint] : soundLineShown}</span>
            <span className="tn-hint-rule" aria-hidden="true" />
          </div>
        )}

        {paused && (
          <div className="tn-card tn-pause" role="dialog" aria-label={copy.pause.title} onPointerDown={e => { if (e.button === 0) resume(); }}>
            <div className="tn-card-body">
              <h2 className="tn-card-title">{copy.pause.title}</h2>
              <div className="tn-hair" aria-hidden="true" />
              <table className="tn-controls">
                <tbody>
                  {copy.pause.controls.map(([key, what]) => <tr key={key}><th scope="row"><kbd>{key}</kbd></th><td>{what}</td></tr>)}
                </tbody>
              </table>
              <div className="tn-hair" aria-hidden="true" />
              <div className="tn-card-line tn-card-prompt">{copy.pause.resume}</div>
            </div>
          </div>
        )}

        {(mode === "death" || mode === "victory") && (
          <div className="tn-card tn-end" role="dialog" aria-label={mode === "death" ? copy.death.title : copy.victory.title}>
            <div className="tn-card-body">
              <h2 className="tn-card-title">{mode === "death" ? copy.death.title : copy.victory.title}</h2>
              <div className="tn-hair" aria-hidden="true" />
              <p className="tn-card-line">{mode === "death" ? copy.death.stats(Math.max(1, wave), formatTime(seconds)) : copy.victory.stats(waves, formatTime(seconds), status.result?.perfect ?? 0)}</p>
              <div className="tn-card-actions">
                <button className="tn-line" onClick={mode === "victory" ? continueJourney : again}>{mode === "victory" ? copy.endcard.continue : copy.endcard.again}</button>
                <button className="tn-line" onClick={toTitle}>{copy.endcard.title}</button>
              </div>
            </div>
          </div>
        )}

        {inPlay && !paused && (
          <div className="touch-controls">
            <div className="touch-move">{[["KeyW","↑"],["KeyA","←"],["KeyS","↓"],["KeyD","→"]].map(([key,label]) => <button key={key} aria-label={copy.touch.move(key.slice(-1))} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); gameRef.current?.setKey?.(key,true); }} onPointerUp={() => gameRef.current?.setKey?.(key,false)} onPointerCancel={() => gameRef.current?.setKey?.(key,false)}>{label}</button>)}</div>
            <button onClick={() => gameRef.current?.attack?.()}>{copy.touch.swing}</button>
          </div>
        )}
      </>}
      {state === "unavailable" ? (
        <p className="temple-night-unavailable" role="status">{copy.unavailable(errorMessage)}</p>
      ) : null}
    </div>
  );
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/* The HUD is bright for T.hudIdle after any change it displays, then rests. */
function useHudAwake(status: GameStatus, on: boolean) {
  const [awake, setAwake] = useState(true);
  const sig = hudSignature(status);
  useEffect(() => {
    if (!on) return undefined;
    setAwake(true);
    const id = window.setTimeout(() => setAwake(false), T.hudIdle);
    return () => window.clearTimeout(id);
  }, [sig, on]);
  return awake;
}

/* Shows a transient value for `ms` after it becomes non-null, then clears
   even if the source keeps it; a new value restarts the clock. */
function useHeld<T>(value: T | null, ms: number) {
  const [held, setHeld] = useState<T | null>(value);
  useEffect(() => {
    if (value == null) { setHeld(null); return undefined; }
    setHeld(value);
    const id = window.setTimeout(() => setHeld(null), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return held;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
