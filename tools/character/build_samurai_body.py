"""Build the samurai body GLB with MPFB2 inside headless Blender.

Run:

    $BL -b --python tools/character/build_samurai_body.py -- --out public/assets/samurai --height 1.74 [--dry] [--decimate 0.6]

Everything that reaches the GLB is CC0 (MakeHuman basemesh, targets and the
makehuman_system_assets pack). MPFB and Rigify are GPL tooling that never ships.

Pipeline (plan A2):
  1. preflight (--dry stops here with a JSON report)
  2. HumanService.create_human with the samurai macro dict
  3. original face via TargetService.load_target
  4. GAMEENGINE skin + eyes / eyebrows / eyelashes
  5. rigify.human metarig -> RigService.generate_rigify_rig
  6. fold constraint-driven helper bones (and, by default, the face rig) into
     the DEF bones the runtime drives; glTF has no constraints
  7. bake masks, remove helper geometry, bake shape keys, optional decimate,
     clamp textures to --max-tex
  8. glTF export (Y-up, rest pose, deform bones only, JPEG textures)
  9. body.json sidecar with bones, rest heads, face landmark UVs
 10. CREDITS.md
"""
import argparse
import importlib
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

# ------------------------------------------------------------------------------------------
# This quirk needs to be copy/pasted into every script. Blender extensions end up
# on unknown places in the module hierarchy, so at write time you don't know the
# absolute package name. Thus we iterate over all modules known by sys to find
# a package and a the key of a declared symbol
#
def dynamic_import(absolute_package_str, key):
    """Quirk to get around blender's extension format's requirement that all imports must be relative"""
    for amod in list(sys.modules):
        if amod.endswith(absolute_package_str):
            mpfb_mod = importlib.import_module(amod)
            if not hasattr(mpfb_mod, key):
                raise AttributeError(f"Module {amod} does not have attribute {key}")
            return getattr(mpfb_mod, key)
    raise ValueError(f"No module found with name ending in {absolute_package_str}")
#
# ------------------------------------------------------------------------------------------

T0 = time.time()


def log(*args):
    print(f"[samurai +{time.time() - T0:6.1f}s]", *args, flush=True)


# ---------------------------------------------------------------------------- config

SKIN = ("young_asian_male.mhmat", "skins")
ASSETS = [  # (file, subdir, asset_type)
    ("low-poly.mhclo", "eyes", "Eyes"),
    ("eyebrow001.mhclo", "eyebrows", "Eyebrows"),
    ("eyelashes01.mhclo", "eyelashes", "Eyelashes"),
]

# MakeHuman macro sliders (0..1). gender 1 = male, age .5 = young adult.
MACROS = {
    "gender": 1.0,
    "age": 0.55,
    "muscle": 0.72,
    "weight": 0.48,
    "proportions": 0.62,
    "height": 0.55,
    "cupsize": 0.5,
    "firmness": 0.5,
    "race": {"asian": 0.75, "caucasian": 0.25, "african": 0.0},
}

# Original face: (targets subdir, file stem, weight). Each is guarded by os.path.exists.
FACE_TARGETS = [
    ("chin", "chin-width-incr", 0.35),
    ("chin", "chin-prominent-incr", 0.30),
    ("chin", "chin-bones-incr", 0.25),
    ("cheek", "l-cheek-bones-incr", 0.40),
    ("cheek", "r-cheek-bones-incr", 0.40),
    ("cheek", "l-cheek-volume-decr", 0.25),
    ("cheek", "r-cheek-volume-decr", 0.25),
    ("nose", "nose-width1-incr", 0.20),
    ("nose", "nose-scale-vert-incr", 0.15),
    ("eyes", "l-eye-height2-decr", 0.20),
    ("eyes", "r-eye-height2-decr", 0.20),
    ("mouth", "mouth-scale-horiz-incr", 0.20),
    ("mouth", "mouth-lowerlip-volume-decr", 0.15),
    ("forehead", "forehead-scale-vert-incr", 0.20),
    ("head", "head-rectangular", 0.30),
    ("eyebrows", "eyebrows-trans-down", 0.15),
]

# Deform bones the runtime drives (plan A4 BONES table + the chain bones between them).
# Everything else that deforms (face rig, breasts, MPFB helpers) is folded into these.
KEEP_PREFIXES = (
    "DEF-spine", "DEF-pelvis", "DEF-shoulder",
    "DEF-upper_arm", "DEF-forearm", "DEF-hand",
    "DEF-thigh", "DEF-shin", "DEF-foot", "DEF-toe",
    "DEF-palm", "DEF-thumb", "DEF-f_index", "DEF-f_middle", "DEF-f_ring", "DEF-f_pinky",
)
HEAD_BONE = "DEF-spine.006"
TRI_BUDGET = 30000


# ---------------------------------------------------------------------------- args

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Build the samurai body GLB with MPFB2")
    p.add_argument("--out", default="public/assets/samurai", help="output directory")
    p.add_argument("--height", type=float, default=1.74, help="final height in metres")
    p.add_argument("--dry", action="store_true", help="preflight only; print a JSON report")
    p.add_argument("--decimate", type=float, default=None,
                   help="decimate ratio (0..1). Default: none unless triangles exceed the budget")
    p.add_argument("--tri-budget", type=int, default=TRI_BUDGET)
    p.add_argument("--max-tex", type=int, default=2048, help="clamp texture size")
    p.add_argument("--bake-normal", action="store_true",
                   help="bake a tangent normal map from the procedural skin (not implemented; logged and skipped)")
    p.add_argument("--keep-face-bones", action="store_true",
                   help="keep the Rigify face DEF bones instead of folding them into the head")
    p.add_argument("--blend", default=None, help="also save a .blend at this path for inspection (keep it out of public/)")
    return p.parse_args(argv)


# ---------------------------------------------------------------------------- helpers

def blender_to_gltf(v):
    """Blender Z-up (x, y, z) -> glTF Y-up (x, z, -y)."""
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


def deselect_all():
    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')


def mesh_children(rig):
    return [o for o in bpy.data.objects if o.type == 'MESH' and
            (o.parent == rig or any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers))]


def triangle_count(obj):
    return sum(max(len(p.vertices) - 2, 0) for p in obj.data.polygons)


def deform_ancestor(bone, keep):
    b = bone.parent
    while b is not None:
        if b.name in keep:
            return b.name
        b = b.parent
    return None


def to_def(name):
    if name.startswith("ORG-") or name.startswith("MCH-"):
        name = name[4:]
    if not name.startswith("DEF-"):
        name = "DEF-" + name
    return name


def resolve_ancestor(bone, keep):
    """Nearest kept DEF bone up the parent chain, mapping ORG-/MCH- names to their DEF twin
    (Rigify parents DEF bones to ORG/MCH bones, so a plain deform walk finds nothing)."""
    q = bone.parent
    while q is not None:
        if q.name in keep:
            return q.name
        cand = to_def(q.name)
        if cand in keep and cand != bone.name:
            return cand
        q = q.parent
    return None


def nearest_spine_bone(rig, bone, keep):
    """Kept DEF-spine* bone whose rest segment is closest to `bone`'s head. Used for bones whose
    Rigify parent chain has no root (e.g. MCH-breast-parent)."""
    best, best_d = None, None
    p = bone.head_local
    for name in keep:
        if not name.startswith("DEF-spine"):
            continue
        b = rig.data.bones[name]
        a, c = b.head_local, b.tail_local
        ac = c - a
        t = max(0.0, min(1.0, (p - a).dot(ac) / max(ac.length_squared, 1e-9)))
        d = (p - (a + ac * t)).length
        if best_d is None or d < best_d:
            best, best_d = name, d
    return best


def fold_targets_for(rig, pbone, keep):
    """Return {target_bone: weight} describing where a folded bone's skin weights go.

    ARMATURE constraint  -> its targets by weight (elbow/knee helpers: 50/50 between the
                            two limb segments)
    COPY_* / TRANSFORM   -> influence (TRANSFORM: 0.5) to the target, the rest to the nearest
                            kept ancestor (shoulder/pelvis helpers)
    no constraint        -> nearest kept ancestor (face rig -> head, breasts -> chest)
    """
    targets = {}
    anc = resolve_ancestor(pbone.bone, keep)
    for con in pbone.constraints:
        if con.type == 'ARMATURE':
            for t in con.targets:
                cand = to_def(t.subtarget)
                if cand in keep:
                    targets[cand] = targets.get(cand, 0.0) + t.weight
        elif con.type in ('COPY_TRANSFORMS', 'COPY_ROTATION', 'COPY_LOCATION', 'TRANSFORM') \
                and getattr(con, "subtarget", ""):
            cand = to_def(con.subtarget)
            if cand in keep and cand not in targets:
                f = con.influence if con.type != 'TRANSFORM' else 0.5
                targets[cand] = targets.get(cand, 0.0) + f
                if anc and f < 0.999:
                    targets[anc] = targets.get(anc, 0.0) + (1.0 - f)
    if not targets:
        if anc is None:
            anc = nearest_spine_bone(rig, pbone.bone, keep) or (HEAD_BONE if HEAD_BONE in keep else None)
        if anc:
            targets[anc] = 1.0
    total = sum(targets.values())
    if total <= 0:
        return {}
    return {k: v / total for k, v in targets.items()}


def fold_bones(rig, meshes, keep_face):
    """Fold helper bones (and optionally the face rig) into kept DEF bones. Returns fold table."""
    deform = [b for b in rig.data.bones if b.use_deform]
    keep = set()
    for b in deform:
        if "helper" in b.name.lower():
            continue
        if b.name.startswith(KEEP_PREFIXES):
            keep.add(b.name)
        elif keep_face:
            keep.add(b.name)
    fold = {}
    for b in deform:
        if b.name in keep:
            continue
        fold[b.name] = fold_targets_for(rig, rig.pose.bones[b.name], keep)

    # Redistribute vertex weights
    for mesh in meshes:
        vg = mesh.vertex_groups
        for src_name, targets in fold.items():
            if src_name not in vg or not targets:
                continue
            src = vg[src_name]
            tgt_groups = {}
            for tname in targets:
                tgt_groups[tname] = vg[tname] if tname in vg else vg.new(name=tname)
            for v in mesh.data.vertices:
                w = None
                for g in v.groups:
                    if g.group == src.index:
                        w = g.weight
                        break
                if w is None or w <= 0.0:
                    continue
                for tname, frac in targets.items():
                    tgt_groups[tname].add([v.index], w * frac, 'ADD')
            vg.remove(src)
        # drop any leftover groups that don't map to a kept bone (non-bone groups are harmless
        # but keep the export clean)
        for g in list(vg):
            if g.name.startswith("DEF-") and g.name not in keep:
                vg.remove(g)

    # Remove the folded bones from the armature
    deselect_all()
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    rig.hide_viewport = False
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    removed = 0
    for name in list(fold):
        if name in eb:
            eb.remove(eb[name])
            removed += 1

    # Rigify parents DEF-thigh/pelvis/shoulder/upper_arm to ORG/MCH bones, not to the DEF
    # chain, so the glTF exporter (deform bones only) would leave them as root joints and the
    # hips would no longer carry the limbs. Re-parent each kept bone that has no kept ancestor
    # to the DEF twin of its nearest ORG ancestor, with a name-based fallback.
    def kept_ancestor(b):
        q = b.parent
        while q is not None:
            if q.name in keep:
                return q.name
            q = q.parent
        return None

    def fallback_parent(name):
        side = name[-2:] if name[-2:] in (".L", ".R") else ""
        base = name[4:].split(".")[0]
        if base in ("thigh", "pelvis"):
            return "DEF-spine"
        if base == "shoulder":
            return "DEF-spine.003"
        if base == "upper_arm":
            return "DEF-shoulder" + side
        return None

    reparented = {}
    for name in sorted(keep):
        b = eb.get(name)
        if b is None or kept_ancestor(b) is not None:
            continue
        target = None
        q = b.parent
        while q is not None:
            cand = to_def(q.name)
            if cand in keep and cand != name:
                target = cand
                break
            q = q.parent
        if target is None:
            target = fallback_parent(name)
        if target and target in eb and target != name:
            b.parent = eb[target]
            b.use_connect = False
            reparented[name] = target
    bpy.ops.object.mode_set(mode='OBJECT')
    for k, v in reparented.items():
        log("  reparent", k, "->", v)
    # Deform flags: only kept bones deform
    for b in rig.data.bones:
        b.use_deform = b.name in keep
    return fold, keep, removed


def normalise_weights(mesh, keep):
    """Clamp each vertex to its 4 strongest kept-bone weights and normalise."""
    vg = mesh.vertex_groups
    kept_idx = {g.index: g for g in vg if g.name in keep}
    for v in mesh.data.vertices:
        ws = [(g.weight, g.group) for g in v.groups if g.group in kept_idx and g.weight > 0]
        if not ws:
            continue
        ws.sort(reverse=True)
        top = ws[:4]
        total = sum(w for w, _ in top)
        for w, gi in ws[4:]:
            kept_idx[gi].remove([v.index])
        for w, gi in top:
            kept_idx[gi].add([v.index], w / total, 'REPLACE')


def image_of_material(mat):
    if not mat or not mat.node_tree:
        return []
    return [n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]


def clamp_images(meshes, max_tex):
    seen = {}
    for m in meshes:
        for mat in m.data.materials:
            for img in image_of_material(mat):
                if img.name in seen:
                    continue
                w, h = img.size
                if w > max_tex or h > max_tex:
                    f = max_tex / max(w, h)
                    img.scale(int(w * f), int(h * f))
                    log(f"scaled {img.name} {w}x{h} -> {img.size[0]}x{img.size[1]}")
                seen[img.name] = list(img.size)
    return seen


def material_has_alpha(mat):
    if not mat or not mat.node_tree:
        return False
    for link in mat.node_tree.links:
        if link.to_node.type == 'BSDF_PRINCIPLED' and link.to_socket.name == 'Alpha':
            return True
    return False


def set_opaque(mat):
    """Cut the image->Alpha link so the exporter writes alphaMode OPAQUE and can use JPEG."""
    if not mat or not mat.node_tree:
        return
    for link in list(mat.node_tree.links):
        if link.to_node.type == 'BSDF_PRINCIPLED' and link.to_socket.name == 'Alpha':
            mat.node_tree.links.remove(link)
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Alpha'].default_value = 1.0
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = 'DITHERED'
    if hasattr(mat, "blend_method"):
        try:
            mat.blend_method = 'OPAQUE'
        except Exception:
            pass


def set_alpha_blend(mat):
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = 'BLENDED'
    if hasattr(mat, "blend_method"):
        try:
            mat.blend_method = 'BLEND'
        except Exception:
            pass
    if hasattr(mat, "use_backface_culling"):
        mat.use_backface_culling = False


def face_landmarks(basemesh, height):
    """Heuristic landmark search on the final (Z-up, metres) basemesh. Returns dict of
    name -> {"p": glTF position, "uv": [u, v]}. The MakeHuman mesh faces -Y."""
    me = basemesh.data
    verts = me.vertices
    uv_layer = me.uv_layers.active
    vert_uv = {}
    if uv_layer:
        for loop in me.loops:
            if loop.vertex_index not in vert_uv:
                uv = uv_layer.data[loop.index].uv
                vert_uv[loop.vertex_index] = [round(uv.x, 5), round(uv.y, 5)]

    head = [v for v in verts if v.co.z > 0.86 * height]
    if not head:
        return {}
    centre_y = sum(v.co.y for v in head) / len(head)
    front = [v for v in head if v.co.y < centre_y]

    def pick(cands, key):
        return min(cands, key=key) if cands else None

    nose = pick([v for v in front if abs(v.co.x) < 0.012], lambda v: v.co.y)
    if nose is None:
        return {}
    nz, ny = nose.co.z, nose.co.y
    chin = pick([v for v in front if abs(v.co.x) < 0.010 and nz - 0.13 < v.co.z < nz - 0.05],
                lambda v: v.co.y + 0.35 * (v.co.z - (nz - 0.09)) ** 2 * 100)
    brow_l = pick([v for v in front if 0.02 < v.co.x < 0.05 and nz + 0.035 < v.co.z < nz + 0.075],
                  lambda v: v.co.y)
    brow_r = pick([v for v in front if -0.05 < v.co.x < -0.02 and nz + 0.035 < v.co.z < nz + 0.075],
                  lambda v: v.co.y)
    cz = chin.co.z if chin else nz - 0.09
    jaw_band = [v for v in head if cz - 0.005 < v.co.z < cz + 0.035 and v.co.y < ny + 0.11]
    jaw_l = pick(jaw_band, lambda v: -v.co.x)
    jaw_r = pick(jaw_band, lambda v: v.co.x)
    out = {}
    for name, v in [("nose", nose), ("chin", chin), ("browL", brow_l), ("browR", brow_r),
                    ("jawL", jaw_l), ("jawR", jaw_r)]:
        if v is not None:
            out[name] = {"p": blender_to_gltf(v.co), "uv": vert_uv.get(v.index)}
    return out


# ---------------------------------------------------------------------------- main

def main():
    args = parse_args()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
    TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")
    RigService = dynamic_import("mpfb.services.rigservice", "RigService")
    ExportService = dynamic_import("mpfb.services.exportservice", "ExportService")
    AssetService = dynamic_import("mpfb.services.assetservice", "AssetService")
    LocationService = dynamic_import("mpfb.services.locationservice", "LocationService")
    SystemService = dynamic_import("mpfb.services.systemservice", "SystemService")
    ObjectService = dynamic_import("mpfb.services.objectservice", "ObjectService")

    # ---- 1. preflight
    report = {
        "blender": bpy.app.version_string,
        "mpfb_module": [m for m in sys.modules if m.endswith("mpfb.services.humanservice")],
        "rigify": SystemService.check_for_rigify(),
        "system_assets_pack": AssetService.system_assets_pack_is_installed(),
        "user_data": LocationService.get_user_data(),
        "mpfb_data": LocationService.get_mpfb_data(),
        "assets": {},
        "face_targets": {},
        "args": vars(args),
    }
    skin_path = AssetService.find_asset_absolute_path(SKIN[0], asset_subdir=SKIN[1])
    report["assets"]["skin"] = skin_path
    asset_paths = []
    for fname, subdir, atype in ASSETS:
        p = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
        report["assets"][fname] = p
        asset_paths.append((p, atype, fname))
    targets_dir = LocationService.get_mpfb_data("targets")
    face_paths = []
    for subdir, stem, w in FACE_TARGETS:
        p = os.path.join(targets_dir, subdir, stem + ".target.gz")
        ok = os.path.exists(p)
        report["face_targets"][stem] = ok
        face_paths.append((p, stem, w, ok))
    problems = []
    if not report["rigify"]:
        problems.append("rigify not enabled (run tools/character/install_mpfb.sh)")
    if not report["system_assets_pack"]:
        problems.append("makehuman_system_assets not installed: download "
                        "https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip "
                        "and run tools/character/install_assets.py --zip <file>")
    if not skin_path:
        problems.append(f"skin {SKIN[0]} not found")
    report["problems"] = problems
    print("PREFLIGHT " + json.dumps(report, indent=2, default=str))
    if args.dry:
        return
    if problems:
        raise SystemExit("preflight failed: " + "; ".join(problems))
    if args.bake_normal:
        log("--bake-normal requested: not implemented in this pass, skipping (ships without a normal map)")

    # ---- 2. human
    macro = TargetService.get_default_macro_info_dict()
    for k, v in MACROS.items():
        if k == "race":
            macro["race"] = dict(v)
        else:
            macro[k] = v
    basemesh = HumanService.create_human(macro_detail_dict=macro)
    basemesh.name = "samurai"
    log("basemesh", basemesh.name, "verts", len(basemesh.data.vertices))

    # ---- 3. face targets
    for p, stem, w, ok in face_paths:
        if not ok:
            log("face target missing, skipped:", stem)
            continue
        TargetService.load_target(basemesh, p, weight=w)
        log(f"face target {stem} = {w}")

    # ---- 4. skin, then rig, then assets (assets must exist before rigify generation so
    # RigifyHelpers.adjust_children_for_rigify re-parents and renames their groups)
    HumanService.set_character_skin(skin_path, basemesh, skin_type="GAMEENGINE")
    log("skin set:", os.path.basename(skin_path))

    # ---- 5a. metarig
    metarig = HumanService.add_builtin_rig(basemesh, "rigify.human")
    log("metarig", metarig.name, "bones", len(metarig.data.bones))

    for p, atype, fname in asset_paths:
        if not p:
            log("asset missing, skipped:", fname)
            continue
        obj = HumanService.add_mhclo_asset(p, basemesh, asset_type=atype, subdiv_levels=0,
                                           material_type="GAMEENGINE")
        log("asset", atype, obj.name, "verts", len(obj.data.vertices))

    # ---- 5b. rigify
    rig = None
    try:
        rig = RigService.generate_rigify_rig(metarig, meta_rig_action="delete")
    except Exception as e:  # noqa
        log("RigService.generate_rigify_rig raised:", repr(e))
    if rig is None:
        log("falling back to bpy.ops.pose.rigify_generate() with the metarig active")
        deselect_all()
        metarig.select_set(True)
        bpy.context.view_layer.objects.active = metarig
        bpy.ops.pose.rigify_generate()
        rig = bpy.context.active_object
        RigifyHelpers = dynamic_import("mpfb.entities.rigging.rigifyhelpers.rigifyhelpers", "RigifyHelpers")
        RigifyHelpers.adjust_children_for_rigify(rig, metarig)
        bpy.data.objects.remove(metarig, do_unlink=True)
    rig.name = rig.data.name = "samurai.rig"
    deform_names = [b.name for b in rig.data.bones if b.use_deform]
    log("rigify rig", rig.name, "bones", len(rig.data.bones), "deform", len(deform_names))

    meshes = mesh_children(rig)
    log("skinned meshes:", [m.name for m in meshes])

    # ---- 6. fold helper (and face) bones
    fold, keep, removed = fold_bones(rig, meshes, args.keep_face_bones)
    helper_fold = {k: v for k, v in fold.items() if "helper" in k.lower()}
    log(f"folded {removed} bones ({len(helper_fold)} helpers, {len(fold) - len(helper_fold)} others); kept {len(keep)}")
    for k, v in sorted(helper_fold.items()):
        log("  helper", k, "->", {t: round(w, 3) for t, w in v.items()})

    # ---- 7. bake modifiers, remove helper geometry, bake shape keys, decimate
    deselect_all()
    basemesh.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    ExportService.bake_modifiers_remove_helpers(basemesh, bake_masks=True, remove_helpers=True, also_proxy=True)
    for m in meshes:
        if m.data.shape_keys:
            TargetService.bake_targets(m)
        for mod in list(m.modifiers):
            if mod.type != 'ARMATURE':
                deselect_all()
                m.select_set(True)
                bpy.context.view_layer.objects.active = m
                try:
                    bpy.ops.object.modifier_apply(modifier=mod.name)
                except Exception as e:  # noqa
                    log("could not apply", mod.name, "on", m.name, repr(e), "- removing")
                    m.modifiers.remove(mod)
        # glTF wants triangles/quads only, and clean groups
        normalise_weights(m, keep)
    tris = {m.name: triangle_count(m) for m in meshes}
    total_tris = sum(tris.values())
    log("triangles before decimate:", tris, "total", total_tris)

    ratio = args.decimate
    if ratio is None and total_tris > args.tri_budget:
        ratio = args.tri_budget / total_tris * 0.98
        log(f"over budget ({total_tris} > {args.tri_budget}); auto decimate ratio {ratio:.3f}")
    if ratio is not None and ratio < 1.0:
        # decimate the body only; eyes/brows/lashes are already tiny
        deselect_all()
        basemesh.select_set(True)
        bpy.context.view_layer.objects.active = basemesh
        mod = basemesh.modifiers.new("Decimate", 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        mod.use_symmetry = True
        mod.symmetry_axis = 'X'
        bpy.ops.object.modifier_apply(modifier=mod.name)
        normalise_weights(basemesh, keep)
        tris = {m.name: triangle_count(m) for m in meshes}
        total_tris = sum(tris.values())
        log("triangles after decimate:", tris, "total", total_tris)

    # ---- 7b. height
    zs = [(basemesh.matrix_world @ v.co).z for v in basemesh.data.vertices]
    cur_h = max(zs) - min(zs)
    scale = args.height / cur_h
    log(f"height {cur_h:.4f} m -> {args.height} m (scale {scale:.4f})")
    deselect_all()
    rig.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = rig
    rig.scale = (scale, scale, scale)
    rig.location.z -= min(zs) * scale
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    zs = [(basemesh.matrix_world @ v.co).z for v in basemesh.data.vertices]
    final_h = max(zs) - min(zs)
    log(f"final height {final_h:.4f} m, feet at z={min(zs):.4f}")

    # ---- 7c. textures / materials
    tex_sizes = clamp_images(meshes, args.max_tex)
    # Only brows and lashes are cut-outs; skin and eyes must be OPAQUE (BLEND on the body
    # sorts badly in three.js and forces PNG textures).
    for m in meshes:
        cutout = any(k in m.name.lower() for k in ("eyebrow", "eyelash"))
        for mat in m.data.materials:
            if cutout and material_has_alpha(mat):
                set_alpha_blend(mat)
            else:
                set_opaque(mat)
    log("textures:", tex_sizes)

    # ---- 8. export
    deselect_all()
    rig.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = rig
    glb = os.path.join(out_dir, "body.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_def_bones=True,
        export_skins=True,
        export_all_influences=False,
        export_influence_nb=4,
        export_animations=False,
        export_morph=False,
        export_image_format='JPEG',
        export_jpeg_quality=85,
        export_rest_position_armature=True,
        export_materials='EXPORT',
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_hierarchy_flatten_bones=False,
        export_leaf_bone=False,
        export_extras=False,
        export_lights=False,
        export_cameras=False,
    )
    size = os.path.getsize(glb)
    log(f"wrote {glb} ({size / 1e6:.2f} MB)")

    if args.blend:
        os.makedirs(os.path.dirname(os.path.abspath(args.blend)), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))

    # ---- 9. sidecar
    deform_bones = [b for b in rig.data.bones if b.use_deform]
    exported = []
    for b in deform_bones:
        head_w = rig.matrix_world @ b.head_local
        tail_w = rig.matrix_world @ b.tail_local
        parent = deform_ancestor(b, {x.name for x in deform_bones})
        exported.append({
            "name": b.name,
            "parent": parent,
            "head": blender_to_gltf(head_w),
            "tail": blender_to_gltf(tail_w),
        })
    upper_arm = next((e for e in exported if e["name"] == "DEF-upper_arm.L"), None)
    arm_dir = None
    if upper_arm:
        d = Vector(upper_arm["tail"]) - Vector(upper_arm["head"])
        d.normalize()
        arm_dir = [round(x, 4) for x in d]
    landmarks = face_landmarks(basemesh, final_h)
    facing = "-Z" if landmarks.get("nose") and landmarks["nose"]["p"][2] < 0 else "+Z"
    sidecar = {
        "version": 1,
        "source": "MPFB2 (MakeHuman basemesh, CC0) + makehuman_system_assets (CC0); see CREDITS.md",
        "height": round(final_h, 4),
        "units": "metres, glTF Y-up",
        "facing": facing,
        "restPose": "A-pose (MakeHuman default)",
        "upperArmLDirection": arm_dir,
        "triangles": total_tris,
        "trianglesByMesh": tris,
        "glbBytes": size,
        "textures": tex_sizes,
        "skin": os.path.basename(skin_path),
        "assets": [fname for p, atype, fname in asset_paths if p],
        "macros": MACROS,
        "faceTargets": {stem: w for p, stem, w, ok in face_paths if ok},
        "roles": {
            "_note": "MPFB rigify.human layout, read off the rest heights: differs from the "
                     "plan's guess (chest .003 / neck .004). Shoulders hang off DEF-spine.004.",
            "hips": "DEF-spine", "spine": "DEF-spine.001", "spine2": "DEF-spine.002",
            "spine3": "DEF-spine.003", "chest": "DEF-spine.004", "neck": "DEF-spine.005",
            "head": "DEF-spine.006",
            "leftArm": "DEF-upper_arm.L", "leftForearm": "DEF-forearm.L", "leftHand": "DEF-hand.L",
            "rightArm": "DEF-upper_arm.R", "rightForearm": "DEF-forearm.R", "rightHand": "DEF-hand.R",
            "leftThigh": "DEF-thigh.L", "leftShin": "DEF-shin.L", "leftFoot": "DEF-foot.L",
            "rightThigh": "DEF-thigh.R", "rightShin": "DEF-shin.R", "rightFoot": "DEF-foot.R",
        },
        "bones": [e["name"] for e in exported],
        "boneParents": {e["name"]: e["parent"] for e in exported},
        "restHeads": {e["name"]: e["head"] for e in exported},
        "restTails": {e["name"]: e["tail"] for e in exported},
        "foldedBones": {k: {t: round(w, 4) for t, w in v.items()} for k, v in fold.items()},
        "faceLandmarks": landmarks,
    }
    with open(os.path.join(out_dir, "body.json"), "w") as f:
        json.dump(sidecar, f, indent=2)

    # ---- 10. credits
    credits = """# Samurai body assets

`body.glb` and `body.json` in this directory were generated headlessly by
`tools/character/build_samurai_body.py`. Only permissively licensed data reaches
the GLB.

| Component | Source | Licence |
|---|---|---|
| Base mesh, modelling targets (macro + face targets) | MakeHuman / MPFB2 `data/` (makehumancommunity/mpfb2) | CC0 1.0 |
| Skin `young_asian_male.mhmat` (+ `young_lightskinned_male_diffuse3.png`) | makehuman_system_assets pack | CC0 1.0 |
| Eyes `low-poly`, eyebrows `eyebrow001`, eyelashes `eyelashes01` (+ textures) | makehuman_system_assets pack | CC0 1.0 |
| Skeleton layout (Rigify metarig fitted by MPFB, DEF bones only) | MPFB2 `data/rigs/rigify` + Blender Rigify | CC0 data; generated by GPL tools |

Tooling (never shipped, not linked into the game):

- MPFB2 (MakeHuman Plugin For Blender) - GPLv3 (code) / CC0 (assets). https://github.com/makehumancommunity/mpfb2
- Blender 5.0 and its bundled Rigify add-on - GPLv2+.

The MakeHuman project released the base mesh, targets and the system assets
under CC0 ("This asset was explicitly released as CC0 in september 2020",
Data Collection AB, Joel Palmius, Jonas Hauquier).

No Ghost of Tsushima assets, footage or extracted data were used. The face is
an original combination of MakeHuman targets; the stubble and scar are painted
at runtime.
"""
    with open(os.path.join(out_dir, "CREDITS.md"), "w") as f:
        f.write(credits)

    # ---- summary
    print("\n=== SAMURAI BODY SUMMARY ===")
    print("bones (%d):" % len(exported))
    for e in exported:
        print(f"  {e['name']:<28} parent={e['parent']}")
    print("triangles:", total_tris, tris)
    print("glb bytes:", size, f"({size / 1e6:.2f} MB)")
    print("height:", round(final_h, 4))
    print("textures:", tex_sizes)
    print("upper_arm.L direction (glTF Y-up):", arm_dir)
    print("facing:", facing)
    print("landmarks:", json.dumps(landmarks))
    print("=== END ===")


if __name__ == "__main__":
    main()
