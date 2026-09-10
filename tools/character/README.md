# Samurai body pipeline (Phase A1 / A2)

Generates `public/assets/samurai/body.glb` (+ `body.json`, `CREDITS.md`): a rigged,
textured human body built headlessly with Blender 5.0.1 and the MPFB2
(MakeHuman Plugin For Blender) extension. Nothing GPL ships; only CC0 mesh,
targets and textures reach the GLB.

```
BL=/Applications/Blender.app/Contents/MacOS/Blender
SCRATCH=/some/scratch/dir

# 1. tooling: clone + build + install MPFB2, enable Rigify   (~1 min)
tools/character/install_mpfb.sh "$SCRATCH"

# 2. CC0 asset pack (skin, eyes, brows, lashes; ~280 MB, resumable)
curl -L -C - -o "$SCRATCH/makehuman_system_assets_cc0.zip" \
  https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
$BL -b --python tools/character/install_assets.py -- --zip "$SCRATCH/makehuman_system_assets_cc0.zip"

# 3. preflight, then build                                    (~15 s)
$BL -b --python tools/character/build_samurai_body.py -- --out public/assets/samurai --height 1.74 --dry
$BL -b --python tools/character/build_samurai_body.py -- --out public/assets/samurai --height 1.74

# 4. checks
python3 tools/character/inspect_glb.py public/assets/samurai/body.glb
$BL -b --python tools/character/check_glb_blender.py -- public/assets/samurai/body.glb
```

## Files

| File | Purpose |
|---|---|
| `install_mpfb.sh` | Shallow-clones `makehumancommunity/mpfb2`, runs `blender --command extension build --source-dir <clone>/src/mpfb` (the manifest lives there), `extension install-file <zip> -r user_default -e`, enables `rigify` + `bl_ext.user_default.mpfb` and saves user prefs. Ends with an import smoke test. |
| `install_assets.py` | Extracts the system-assets zip with `AssetService.fix_and_extract_asset_pack_zip(zip, LocationService.get_user_data())`, rescans pack metadata, asserts `system_assets_pack_is_installed()` and resolves the four assets the build uses. |
| `build_samurai_body.py` | The build (below). `--dry` prints a JSON preflight and stops. |
| `inspect_glb.py` | Dependency-free GLB JSON/BIN parser: nodes, skins, joints, materials, image formats and sizes, non-finite checks, weight sums, rest direction of `DEF-upper_arm.L`. |
| `check_glb_blender.py` | Reimports the GLB in Blender and prints the bone hierarchy, skinned meshes, vertex groups and NaN/unweighted counts. |

Where MPFB puts things on this machine (Blender 5.0):

- extension: `~/Library/Application Support/Blender/5.0/extensions/user_default/mpfb`
- user data (asset packs): `~/Library/Application Support/Blender/5.0/extensions/.user/user_default/mpfb/data`

## Build steps (`build_samurai_body.py`)

Options after `--`: `--out DIR`, `--height M` (1.74), `--dry`, `--decimate RATIO`
(default: none unless triangles exceed `--tri-budget`, 30000), `--max-tex N` (2048),
`--keep-face-bones`, `--blend PATH` (debug save, keep it out of `public/`),
`--bake-normal` (accepted, not implemented: logged and skipped; the body ships with the
diffuse only).

1. **Preflight**: `SystemService.check_for_rigify()`, `AssetService.system_assets_pack_is_installed()`,
   `AssetService.find_asset_absolute_path()` for `young_asian_male.mhmat`, `low-poly.mhclo`,
   `eyebrow001.mhclo`, `eyelashes01.mhclo`; `os.path.exists` on each face target.
2. **Human**: `HumanService.create_human(macro_detail_dict=...)` with gender 1.0 (male),
   age .55, muscle .72, weight .48, proportions .62, height .55, race asian .75 / caucasian .25.
3. **Face**: 16 `TargetService.load_target()` calls (chin width/prominence/bones, cheekbones,
   cheek volume down, nose width, eye height, mouth width, lower-lip volume down, forehead
   height, rectangular head, brows down). All bundled with MPFB (CC0).
4. **Materials**: `set_character_skin(..., skin_type="GAMEENGINE")`, then
   `add_mhclo_asset(..., subdiv_levels=0, material_type="GAMEENGINE")` for eyes, brows, lashes.
   Skin and eyes are made opaque (the image->Alpha link is cut) so they export `OPAQUE` and as
   JPEG; brows and lashes keep alpha and export `BLEND` as PNG.
5. **Rig**: `HumanService.add_builtin_rig(basemesh, "rigify.human")` then
   `RigService.generate_rigify_rig(metarig, meta_rig_action="delete")`. A fallback to
   `bpy.ops.pose.rigify_generate()` exists but was not needed on 5.0.1.
6. **Bone fold**: glTF has no constraints, so every deform bone that is not in the kept set
   (spine chain, pelvis, shoulders, arms, hands, fingers, legs, feet, toes) is folded:
   - MPFB helpers with an ARMATURE constraint (`DEF-elbow-helper.*`, `DEF-knee-helper.*`)
     split 50/50 into the two limb segments;
   - `COPY_TRANSFORMS`/`TRANSFORM` helpers (`DEF-shoulder-helper.*`, `DEF-pelvis-helper.*`)
     go half to the constraint target and half to the nearest kept ancestor;
   - the Rigify face rig (98 bones: lips, brows, lids, jaw, eyes, teeth, tongue, ears, nose,
     cheeks) goes to `DEF-spine.006` (head); breasts go to the nearest spine segment.
   Weights are redistributed per vertex, groups and bones removed, then each vertex is
   clamped to its 4 strongest influences and normalised.
   Rigify parents `DEF-thigh/pelvis/shoulder/upper_arm` to ORG/MCH bones, which the
   deform-only export would turn into root joints; they are re-parented to the DEF twin of
   their nearest ORG ancestor (`thigh/pelvis -> DEF-spine`, `shoulder -> DEF-spine.004`,
   `upper_arm -> DEF-shoulder`).
7. **Bake**: `ExportService.bake_modifiers_remove_helpers(basemesh, bake_masks=True,
   remove_helpers=True, also_proxy=True)`, `TargetService.bake_targets()` on every mesh,
   non-armature modifiers applied, optional decimate (body only, collapse, X symmetry),
   uniform scale to `--height` applied to rig and meshes, textures clamped to `--max-tex`.
8. **Export**: `bpy.ops.export_scene.gltf(export_format='GLB', use_selection=True,
   export_apply=True, export_yup=True, export_def_bones=True, export_skins=True,
   export_all_influences=False, export_influence_nb=4, export_animations=False,
   export_morph=False, export_image_format='JPEG', export_jpeg_quality=85,
   export_rest_position_armature=True, ...)`.
9. **Sidecar `body.json`**: height, facing, rest pose, triangle counts, GLB size, texture sizes,
   bone list with parents, rest heads/tails (glTF Y-up metres), the fold table, a `roles` map,
   and heuristic face landmarks (nose, chin, browL/R, jawL/R) as positions and UVs.
10. **`CREDITS.md`** in the output directory.

## Result (current build)

- 71 joints, one skin, 4 meshes: body 26,756 tris (14,517 verts), eyes 172, brows 192,
  lashes 368 -> 27,488 triangles total. No decimation needed.
- `body.glb` 1.44 MB. Textures: skin 2048x2048 JPEG (244 KB), eye 1024x1024 JPEG,
  brows and lashes 512x512 PNG (alpha).
- Height exactly 1.740 m, feet at y = 0. Faces **+Z** in glTF (MakeHuman faces -Y in Blender).
- Rest pose: MakeHuman **A-pose**; `DEF-upper_arm.L` points (0.66, -0.75, 0.00) in glTF
  space, i.e. 41 degrees out from straight down.
- Spine roles read off the rest heights (MPFB's `rigify.human` metarig, not the default
  Rigify guess): `DEF-spine` hips (0.84 m), `.001/.002/.003` lower/mid spine,
  **`.004` chest** (1.28-1.48 m, shoulders attach here), **`.005` neck**, `.006` head.
  The runtime bone table should use `.004` for chest and `.005` for neck.
- Every vertex is weighted, weights sum to 1, no non-finite positions or normals.

## Licences

- MakeHuman base mesh, modelling targets, `rigify.human` metarig data: **CC0 1.0** (MPFB2 `data/`).
- `makehuman_system_assets` pack (skin `young_asian_male`, eyes `low-poly`, `eyebrow001`,
  `eyelashes01` and their textures): **CC0 1.0** (explicitly released September 2020 by
  Data Collection AB, Joel Palmius, Jonas Hauquier).
- MPFB2 code: GPLv3; Blender and Rigify: GPLv2+. Tooling only; nothing from them is shipped
  or linked into the game.
- No Ghost of Tsushima assets, footage or extracted data were used.

## Notes and known limits

- `--bake-normal` is a stub; the plan says to ship without it first.
- The face landmarks are a geometric heuristic (front-most vertex on the mid-line for the
  nose, etc.); good enough to seed the runtime stubble/scar painting, not anatomically exact.
- The glTF exporter prints `divide by zero encountered in matmul` while extracting the body
  primitive; the exported buffers were checked and contain no non-finite values.
- Re-running `install_mpfb.sh` re-clones only if the clone is missing; delete the clone to
  pick up a newer MPFB.
