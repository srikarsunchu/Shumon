# Temple Night — playable world

A standalone, third-person place to roam, inspired by cinematic samurai games. No required objectives, combat encounters, or story progression.

## First playable
- Preserve the procedural temple, weather, and lighting.
- Add camera-relative walking/running, orbit camera, pause, draw/sheath, and sword swings.
- Use a procedural character to establish scale and controls before selecting final assets.
- Use the existing solid geometry for bounded ground, step, wall, and camera queries. This is a prototype controller, not the planned full physics implementation.
- Desktop keyboard/mouse first; provide basic touch movement and camera drag.

## Next: character feel
- Select a licensed rigged character and compatible idle/walk/run/draw/attack/sheath clips. Record sources and licenses.
- Import GLB, retarget as necessary in Blender, blend locomotion and tune foot contact.
- Replace prototype collision with Rapier's kinematic controller and authored simplified colliders; add slope limits, robust camera collision, and safe recovery.
- Add timed sword sounds and footsteps. No enemies required.

## Next: explorable landscape
- Replace camera-dependent scenery with geometry that works from all directions.
- Expand from the grounds into connected forest, grassland, and ridge areas.
- Add instanced vegetation, wind, distance detail, and intentional world boundaries.
- Choose target hardware, profile, and set a measured frame budget before growing the map.

## Validation
Build and type-check each milestone. Check keyboard movement, stair ascent/descent, walls, camera obstruction, draw/attack/sheath, pause/resume, lost focus, touch release, viewport resize, and unavailable WebGL. Browser playtesting and visual review remain necessary before calling the prototype polished.

## Graphics
Keep the existing WebGL renderer for this first milestone. Reconsider WebGPU only after profiling demonstrates a concrete benefit. No backend is needed.
