# Temple Night

A procedural Three.js (r149) night scene: a mountain temple at the head of a
forty-step flight, a blood moon, rain, drifting haze, falling maple leaves and
cursor-following wisps. Every texture is generated on a 2D canvas at load; no
binary assets are needed.

## Run

```bash
npm install
npm run dev
```

## Layout

- `src/shaders/temple-night/templeNightRenderer.js` — the whole world: textures,
  geometry, lights, post chain, camera rig. Generated from the Kage world; do
  not edit by hand.
- `src/shaders/temple-night/TempleNightScene.tsx` — React host that owns the
  canvas, pointer, visibility and resize lifecycle.
- `src/shaders/threeui.css` — the scene's styles.

## URL flags

`?q=low|high` quality, `?post=0` disables bloom/grade, `?shadow=0`, `?dpr=1.5`,
`?adapt=0` locks the adaptive resolution scaler, `?nogl=1` forces the fallback.
