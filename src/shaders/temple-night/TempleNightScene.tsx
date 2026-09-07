import { useEffect, useRef, useState } from "react";
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
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    let renderer: ReturnType<typeof createTempleNightRenderer>;
    try {
      renderer = createTempleNightRenderer(canvas);
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
      if (!rendered) {
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
    };
  }, []);

  return (
    <div className={`temple-night-scene${className ? ` ${className}` : ""}`} ref={hostRef} data-state={state}>
      <canvas
        ref={canvasRef}
        className={`temple-night-canvas${state === "ready" ? " is-ready" : ""}`}
        aria-label="Interactive Kage mountain temple world after dark"
      />
      {state === "unavailable" ? (
        <p className="temple-night-unavailable" role="status">WebGL is unavailable: {errorMessage || "unsupported context"}.</p>
      ) : null}
    </div>
  );
}
