import { useEffect, useRef, useState } from "react";
import { registerGameTools } from "./templeAgentControls.js";
import { createTempleGameplay } from "./templeGameplay.js";
import { createTempleNightRenderer } from "./templeNightRenderer.js";

/* In the original library this scene also fronted three sibling worlds
   (yosemite-sunset, presidio-sunset, lake-louise) as lazily loaded variants.
   Those renderers are not part of this repo, so only the temple world is
   wired up; the prop is kept so the call site reads the same. */
export type TempleNightVariant = "temple-night";

export type TempleNightSceneProps = {
  className?: string;
  variant?: TempleNightVariant;
};

export function TempleNightScene({ className = "" }: TempleNightSceneProps) {
  return <TempleNightWorld className={className} />;
}

function TempleNightWorld({ className = "" }: { className?: string }) {
  const gameRef = useRef<ReturnType<typeof createTempleGameplay> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [entered, setEntered] = useState(false);
  const [sound, setSound] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    let unregisterTools = () => {};
    let ready = false;
    let mounted = true;
    let renderer: ReturnType<typeof createTempleNightRenderer>;
    try {
      renderer = createTempleNightRenderer(canvas, createTempleGameplay);
      gameRef.current = renderer.gameplay;
      unregisterTools = registerGameTools(renderer.gameplay);
      Promise.all([renderer.gameplay?.ready, renderer.gameplay?.animationReady]).then(() => { if(mounted) ready=true; }).catch(error => {
        if(mounted){setErrorMessage(error instanceof Error ? error.message : "World initialization failed");setState("unavailable");}
      });
      renderer.gameplay?.subscribe((status: { active: boolean; drawn: boolean; sound: boolean }) => {
        setPlaying(status.active); setDrawn(status.drawn); setSound(status.sound);
      });
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
      if (!rendered && ready) {
        rendered = true;
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
      renderer.dispose();
      gameRef.current = null;
    };
  }, []);

  return (
    <div className={`temple-night-scene${className ? ` ${className}` : ""}`} ref={hostRef} data-state={state}>
      <canvas
        ref={canvasRef}
        className={`temple-night-canvas${state === "ready" ? " is-ready" : ""}`}
        aria-label="Temple Night playable mountain temple"
      />
      {state !== "unavailable" && <>
        <div className="game-brand"><span className="brand-mark" aria-hidden="true">月</span><span>TEMPLE NIGHT</span></div>
        {playing ? <>
          <button className="sound-button" aria-pressed={sound} onClick={() => gameRef.current?.toggleSound()}>Sound {sound ? "on" : "off"} <kbd>M</kbd></button>
          <button className="pause-button" onClick={() => gameRef.current?.pause()}>Pause <kbd>Esc</kbd></button>
          <div className="game-controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>Shift</kbd> Run</span><span>Mouse · Look</span><span><kbd>Click / Space</kbd> Swing</span><span><kbd>E</kbd> {drawn ? "Sheathe" : "Draw"}</span></div>
          <div className="touch-controls">
            <div className="touch-move">{[["KeyW","↑"],["KeyA","←"],["KeyS","↓"],["KeyD","→"]].map(([key,label]) => <button key={key} aria-label={`Move ${key.slice(-1)}`} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); gameRef.current?.setKey(key,true); }} onPointerUp={() => gameRef.current?.setKey(key,false)} onPointerCancel={() => gameRef.current?.setKey(key,false)}>{label}</button>)}</div>
            <button onClick={() => gameRef.current?.attack()}>Swing</button>
          </div>
        </> : <div className="game-entry">
          <div className="entry-content">
            <p className="eyebrow">A NIGHT TO WANDER</p>
            <h1>Temple<br/><em>Night</em></h1>
            <div className="entry-rule" />
            <p className="entry-description">Rain on stone. Wind in the maples.<br/>Nowhere you need to be.</p>
            <button className="enter-button" disabled={state !== "ready"} onClick={() => { setEntered(true); gameRef.current?.start(); }}>{state !== "ready" ? "Gathering the night…" : entered ? "Return to the night" : "Enter the grounds"}<span aria-hidden="true">↗</span></button>
            <p className="entry-hint">WASD to wander · Mouse to look · Click to swing<br/>If mouse capture is unavailable, drag with the right button to look.</p>
          </div>
          <span className="edition">PLAYABLE STUDY · 002</span>
        </div>}
      </>}
      {state === "unavailable" ? (
        <p className="temple-night-unavailable" role="status">The world could not load: {errorMessage || "unsupported context"}.</p>
      ) : null}
    </div>
  );
}
