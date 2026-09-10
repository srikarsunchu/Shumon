"""Reimport body.glb in headless Blender and print bones, skinned meshes and sanity checks.

    $BL -b --python tools/character/check_glb_blender.py -- public/assets/samurai/body.glb
"""
import math
import sys

import bpy

path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes = [o for o in bpy.data.objects if o.type == 'MESH'
          and any(m.type == 'ARMATURE' for m in o.modifiers)]
print("armatures:", [a.name for a in arms])
for a in arms:
    print(f"{a.name}: {len(a.data.bones)} bones")
    for b in a.data.bones:
        print(f"  {b.name:<28} parent={b.parent.name if b.parent else None}")
    ua = a.data.bones.get("DEF-upper_arm.L")
    if ua:
        d = (a.matrix_world @ ua.tail_local) - (a.matrix_world @ ua.head_local)
        d.normalize()
        ang = math.degrees(math.acos(max(-1, min(1, -d.z))))
        print(f"DEF-upper_arm.L direction Blender Z-up: {tuple(round(x, 4) for x in d)}  ({ang:.1f} deg from straight down)")
for m in meshes:
    mods = [(mod.type, mod.object.name if getattr(mod, 'object', None) else None) for mod in m.modifiers]
    groups = len(m.vertex_groups)
    nan = sum(1 for v in m.data.vertices if any(math.isnan(c) for c in v.co))
    unweighted = sum(1 for v in m.data.vertices if not v.groups)
    zs = [(m.matrix_world @ v.co).z for v in m.data.vertices]
    print(f"mesh {m.name}: verts={len(m.data.vertices)} polys={len(m.data.polygons)} groups={groups} "
          f"mods={mods} nan={nan} unweighted={unweighted} z=[{min(zs):.3f},{max(zs):.3f}] "
          f"mats={[mat.name for mat in m.data.materials]}")
