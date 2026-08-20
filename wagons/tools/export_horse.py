#!/usr/bin/env python3
"""
export_horse.py — turn the BlendSwap "Horse Rigged All Gaits" .blend into the
game-ready models/horse.glb the media contract asks for.

Run headless:

    /Applications/Blender.app/Contents/MacOS/Blender \
        --background raw/horse-blendswap/horse.blend \
        --python tools/export_horse.py \
        -- --out /tmp/horse-raw.glb

(tools/process.sh does this for you, then runs the result through
gltf-transform for texture resizing + meshopt compression.)

Contract this script targets
----------------------------
  * Y-up, metres, real scale — roughly 1.6 m at the withers.
  * Origin on the ground, between the hooves.
  * Facing +Z in glTF space.
  * Animations named exactly `gallop` (required) plus optional `walk`,
    `trot`, `canter`.
  * No particle hair (mane/tail hair particles do not survive glTF).
  * Textures <= 1K (done downstream by gltf-transform, not here).

Axis note (the thing that trips everyone up)
--------------------------------------------
Blender is Z-up. The glTF exporter's default "+Y up" conversion maps
Blender (x, y, z) -> glTF (x, z, -y). So **Blender -Y becomes glTF +Z**.
Blender's own convention is that characters face -Y ("front" view), so a
correctly-authored .blend needs no rotation at all. This script measures the
bounding box, rotates 90 degrees about Z if the long axis is X, and then
*prints* what it did — it cannot tell nose from tail, so if the exported horse
gallops backwards, re-run with --yaw 180.

Everything here is defensive: the .blend is not in the repo yet, so the script
prints every armature, bone and action it finds, and degrades to a warning
rather than an exception wherever it reasonably can.
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------
# Action-name matching. BlendSwap rigs name their actions all sorts of things
# ("Horse_Gallop", "gallop_cycle", "ACTION_trot", "Armature|Canter"...), so we
# match case-insensitively on substrings, most-specific gait first.
# ---------------------------------------------------------------------------
GAIT_KEYWORDS = {
    "gallop": ("gallop", "run", "sprint"),
    "canter": ("canter", "lope"),
    "trot":   ("trot", "jog"),
    "walk":   ("walk", "step"),
}
REQUIRED_GAITS = ("gallop",)
OPTIONAL_GAITS = ("walk", "trot", "canter")

# Default target: ~1.6 m at the withers works out to roughly 2.0 m total
# height with the head up, which is what a bounding box actually measures.
DEFAULT_TARGET_HEIGHT = 2.0


def log(msg):
    print(f"[export_horse] {msg}", flush=True)


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser(prog="export_horse.py")
    p.add_argument("--out", required=True, help="output .glb path")
    p.add_argument("--target-height", type=float, default=DEFAULT_TARGET_HEIGHT,
                   help="total bbox height in metres to scale to (default 2.0, "
                        "which is ~1.6 m at the withers)")
    p.add_argument("--yaw", type=float, default=None,
                   help="extra yaw in degrees about Z applied before export. "
                        "Use 180 if the horse comes out facing backwards; "
                        "omit to let the script auto-orient by bounding box.")
    p.add_argument("--no-scale", action="store_true",
                   help="trust the .blend's scale; skip the resize step")
    p.add_argument("--keep-hair", action="store_true",
                   help="do not strip particle systems (debugging only)")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Inventory — print what we're working with before touching anything.
# ---------------------------------------------------------------------------
def report_contents():
    log(f"blend file: {bpy.data.filepath or '<none>'}")
    log(f"scene unit system: {bpy.context.scene.unit_settings.system}, "
        f"scale_length={bpy.context.scene.unit_settings.scale_length}")

    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    log(f"objects: {len(bpy.data.objects)} total, "
        f"{len(armatures)} armature(s), {len(meshes)} mesh(es)")

    for arm in armatures:
        bones = [b.name for b in arm.data.bones]
        log(f"  armature '{arm.name}': {len(bones)} bones")
        log(f"    bones: {', '.join(bones)}")

    for m in meshes:
        mods = [f"{mo.name}({mo.type})" for mo in m.modifiers]
        psys = [ps.name for ps in getattr(m, "particle_systems", [])]
        log(f"  mesh '{m.name}': verts={len(m.data.vertices)} "
            f"modifiers=[{', '.join(mods) or '-'}] "
            f"particles=[{', '.join(psys) or '-'}]")

    log(f"actions ({len(bpy.data.actions)}): "
        f"{', '.join(a.name for a in bpy.data.actions) or '-'}")
    return armatures, meshes


def ensure_visible(objs):
    """Un-hide and un-exclude everything — hidden objects don't export."""
    for coll in bpy.data.collections:
        coll.hide_viewport = False
        coll.hide_render = False
    view_layer = bpy.context.view_layer
    def walk(layer_coll):
        layer_coll.exclude = False
        layer_coll.hide_viewport = False
        for child in layer_coll.children:
            walk(child)
    walk(view_layer.layer_collection)
    for o in objs:
        o.hide_set(False)
        o.hide_viewport = False
        o.hide_render = False


# ---------------------------------------------------------------------------
# Cleanup: particle hair, non-armature modifiers, shape-key-safe.
# ---------------------------------------------------------------------------
def strip_particles(meshes):
    removed = 0
    for m in meshes:
        for mod in list(m.modifiers):
            if mod.type == "PARTICLE_SYSTEM":
                m.modifiers.remove(mod)
                removed += 1
        # Blender 3.5+ hair can also be a separate CURVES object; those are
        # dropped later by the "only meshes + armature get exported" filter.
    if removed:
        log(f"stripped {removed} particle system modifier(s)")
    hair_objs = [o for o in bpy.data.objects if o.type in {"CURVES", "HAIR"}]
    for o in hair_objs:
        log(f"removing hair object '{o.name}' ({o.type})")
        bpy.data.objects.remove(o, do_unlink=True)


def apply_modifiers(meshes):
    """Apply every modifier except ARMATURE (applying that would freeze the
    skin) and any modifier that errors — we'd rather ship a slightly heavier
    mesh than fail the whole export."""
    for m in meshes:
        if not m.modifiers:
            continue
        # Shape keys block modifier_apply outright; skip those meshes.
        if m.data.shape_keys is not None:
            log(f"mesh '{m.name}' has shape keys — leaving modifiers unapplied")
            continue
        bpy.context.view_layer.objects.active = m
        for mod in list(m.modifiers):
            if mod.type == "ARMATURE":
                continue
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
                log(f"applied modifier '{mod.name}' ({mod.type}) on '{m.name}'")
            except Exception as exc:  # noqa: BLE001 — never fail the export
                log(f"WARNING could not apply '{mod.name}' on '{m.name}': {exc}")


# ---------------------------------------------------------------------------
# Transform: orient, scale, ground the origin.
# ---------------------------------------------------------------------------
def world_bbox(meshes):
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    found = False
    for m in meshes:
        for corner in m.bound_box:
            p = m.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], p[i]) for i in range(3)))
            hi = Vector((max(hi[i], p[i]) for i in range(3)))
            found = True
    if not found:
        return None, None
    return lo, hi


def make_root(objs):
    """Parent every top-level object under one empty so we can rotate, scale
    and translate the whole rig with a single transform — far safer than
    applying transforms to a skinned mesh + armature separately."""
    root = bpy.data.objects.new("HorseRoot", None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        if o is root or o.parent is not None:
            continue
        o.parent = root
        o.matrix_parent_inverse = root.matrix_world.inverted()
    return root


def orient_and_scale(root, meshes, args):
    bpy.context.view_layer.update()
    lo, hi = world_bbox(meshes)
    if lo is None:
        log("WARNING no mesh geometry found — skipping orient/scale")
        return
    size = hi - lo
    log(f"bbox before: min={tuple(round(v, 3) for v in lo)} "
        f"max={tuple(round(v, 3) for v in hi)} size={tuple(round(v, 3) for v in size)}")

    yaw = args.yaw
    if yaw is None:
        # Auto-orient: the horse's long axis should be Blender Y (which becomes
        # glTF Z). If it's currently X, rotate 90 degrees about Z.
        yaw = 90.0 if size.x > size.y else 0.0
        log(f"auto-orient: long axis is {'X' if size.x > size.y else 'Y'} "
            f"-> yaw {yaw} degrees")
    else:
        log(f"explicit yaw {yaw} degrees")
    root.rotation_euler[2] += math.radians(yaw)
    bpy.context.view_layer.update()

    if not args.no_scale:
        lo, hi = world_bbox(meshes)
        height = (hi - lo).z
        if height <= 1e-6:
            log("WARNING degenerate height — skipping scale")
        else:
            factor = args.target_height / height
            if 0.95 < factor < 1.05:
                log(f"height {height:.3f} m already within 5% of target — no scale")
            else:
                log(f"scaling by {factor:.4f} ({height:.3f} m -> "
                    f"{args.target_height:.3f} m total height)")
                root.scale *= factor
            bpy.context.view_layer.update()

    # Ground the origin: X/Y centred on the bbox, Z on the lowest hoof.
    lo, hi = world_bbox(meshes)
    centre = (lo + hi) * 0.5
    root.location -= Vector((centre.x, centre.y, lo.z))
    bpy.context.view_layer.update()

    lo, hi = world_bbox(meshes)
    log(f"bbox after:  min={tuple(round(v, 3) for v in lo)} "
        f"max={tuple(round(v, 3) for v in hi)}")
    log(f"=> total height {(hi - lo).z:.3f} m, length {(hi - lo).y:.3f} m "
        f"(withers is roughly 80% of total height)")


# ---------------------------------------------------------------------------
# Animations: map actions onto contract names, one NLA track each so the glTF
# exporter emits separate, correctly-named animations.
# ---------------------------------------------------------------------------
def pick_actions():
    """Return {contract_name: action}. Longest keyword match wins, and one
    action is never assigned to two gaits."""
    chosen = {}
    used = set()
    for gait, keywords in GAIT_KEYWORDS.items():
        best = None
        for action in bpy.data.actions:
            if action.name in used:
                continue
            low = action.name.lower()
            for kw in keywords:
                if kw in low:
                    # Prefer the shortest name containing the keyword — that's
                    # usually "gallop" over "gallop_old_backup".
                    if best is None or len(action.name) < len(best.name):
                        best = action
                    break
        if best is not None:
            chosen[gait] = best
            used.add(best.name)
            log(f"gait '{gait}' <- action '{best.name}'")
        else:
            log(f"gait '{gait}': no matching action")

    if "gallop" not in chosen and bpy.data.actions:
        fallback = bpy.data.actions[0]
        log(f"WARNING no gallop action matched — falling back to '{fallback.name}'. "
            f"If that's wrong, rename the action in the .blend and re-run.")
        chosen["gallop"] = fallback
    return chosen


def build_nla(armature, chosen):
    """Wipe existing NLA and lay down one track per contract-named gait."""
    if armature is None:
        log("WARNING no armature — no animations will be exported")
        return []
    ad = armature.animation_data_create()
    ad.action = None
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)

    emitted = []
    for gait in ("gallop",) + OPTIONAL_GAITS:
        action = chosen.get(gait)
        if action is None:
            continue
        # Track name is what the glTF exporter uses for the animation name.
        track = ad.nla_tracks.new()
        track.name = gait
        start = int(action.frame_range[0])
        strip = track.strips.new(gait, start, action)
        strip.name = gait
        track.mute = False
        emitted.append(gait)
        log(f"NLA track '{gait}': action '{action.name}' "
            f"frames {action.frame_range[0]:.0f}-{action.frame_range[1]:.0f}")
    return emitted


# ---------------------------------------------------------------------------
def main():
    args = parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    log("=" * 68)
    armatures, meshes = report_contents()
    log("=" * 68)

    if not meshes:
        log("ERROR no mesh objects in the .blend — nothing to export")
        sys.exit(2)

    ensure_visible(bpy.data.objects)
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object else None
    bpy.ops.object.select_all(action="DESELECT")

    if not args.keep_hair:
        strip_particles(meshes)
    apply_modifiers(meshes)

    armature = armatures[0] if armatures else None
    if len(armatures) > 1:
        # Pick the armature that actually skins the meshes.
        skinning = {mo.object for m in meshes for mo in m.modifiers
                    if mo.type == "ARMATURE" and mo.object}
        if skinning:
            armature = next(iter(skinning))
        log(f"multiple armatures — using '{armature.name}'")

    keep = set(meshes) | ({armature} if armature else set())
    root = make_root(list(keep))
    orient_and_scale(root, meshes, args)

    chosen = pick_actions()
    emitted = build_nla(armature, chosen)
    if "gallop" not in emitted:
        log("WARNING exporting without a 'gallop' animation — the game will "
            "fall back to its procedural horse.")

    # Export only the horse: select the root + everything under it.
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for o in keep:
        o.select_set(True)
    bpy.context.view_layer.objects.active = armature or next(iter(meshes))

    log(f"exporting -> {out}")
    # Uncompressed on purpose: process.sh runs gltf-transform afterwards for
    # texture resizing + meshopt (EXT_meshopt_compression), which needs plain
    # accessor data to work from.
    kwargs = dict(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,          # modifiers already applied by hand
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_force_sampling=True,  # bake constraints/IK into keyframes
        export_bake_animation=True,
        export_optimize_animation_size=True,
        export_skins=True,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    # Blender's glTF operator gains/loses keyword arguments between releases;
    # drop anything this build doesn't understand rather than crashing.
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    unknown = [k for k in kwargs if k not in props]
    for k in unknown:
        log(f"note: this Blender build has no '{k}' export option — skipping it")
        kwargs.pop(k)

    bpy.ops.export_scene.gltf(**kwargs)

    size = os.path.getsize(out) if os.path.exists(out) else 0
    log(f"done: {out} ({size / 1024:.0f} KB), animations: {', '.join(emitted) or 'none'}")


if __name__ == "__main__":
    main()
