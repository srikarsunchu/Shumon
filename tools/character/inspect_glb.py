"""Parse a GLB's JSON chunk without any dependencies and print nodes, skins, joints,
materials, images and mesh stats.

    python3 tools/character/inspect_glb.py public/assets/samurai/body.glb
"""
import json
import struct
import sys


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", "not a GLB"
    off = 12
    chunks = {}
    while off < length:
        clen, ctype = struct.unpack_from("<I4s", data, off)
        off += 8
        chunks[ctype] = data[off:off + clen]
        off += clen
    return json.loads(chunks[b"JSON"]), chunks.get(b"BIN\x00", b"")


def main(path):
    g, binblob = read_glb(path)
    acc = g.get("accessors", [])
    print("file:", path)
    print("generator:", g.get("asset", {}).get("generator"))
    print("nodes:", len(g.get("nodes", [])), "meshes:", len(g.get("meshes", [])),
          "skins:", len(g.get("skins", [])), "materials:", len(g.get("materials", [])),
          "images:", len(g.get("images", [])), "textures:", len(g.get("textures", [])),
          "animations:", len(g.get("animations", [])))
    for i, m in enumerate(g.get("meshes", [])):
        tris = 0
        verts = 0
        has_skin = False
        for p in m.get("primitives", []):
            if "indices" in p:
                tris += acc[p["indices"]]["count"] // 3
            verts += acc[p["attributes"]["POSITION"]]["count"]
            has_skin = has_skin or "JOINTS_0" in p["attributes"]
        print(f"mesh[{i}] {m.get('name')}: verts={verts} tris={tris} skinned={has_skin} "
              f"prims={len(m.get('primitives', []))}")
    import math
    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            for attr in ("POSITION", "NORMAL", "WEIGHTS_0"):
                if attr not in p["attributes"]:
                    continue
                a = acc[p["attributes"][attr]]
                bv = g["bufferViews"][a["bufferView"]]
                ncomp = {"VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
                off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
                stride = bv.get("byteStride", 4 * ncomp)
                bad = 0
                wsum_bad = 0
                for k in range(a["count"]):
                    vals = struct.unpack_from("<%df" % ncomp, binblob, off + k * stride)
                    if any(not math.isfinite(x) for x in vals):
                        bad += 1
                    if attr == "WEIGHTS_0" and abs(sum(vals) - 1.0) > 1e-3:
                        wsum_bad += 1
                extra = f" weight-sum!=1: {wsum_bad}" if attr == "WEIGHTS_0" else ""
                print(f"  {m.get('name')} {attr}: {a['count']} non-finite={bad}{extra}")
    for i, s in enumerate(g.get("skins", [])):
        names = [g["nodes"][j].get("name") for j in s["joints"]]
        print(f"skin[{i}] {s.get('name')}: {len(names)} joints, skeleton={s.get('skeleton')}")
        for n in names:
            print("   ", n)
    for i, mat in enumerate(g.get("materials", [])):
        pbr = mat.get("pbrMetallicRoughness", {})
        print(f"material[{i}] {mat.get('name')}: alphaMode={mat.get('alphaMode', 'OPAQUE')} "
              f"doubleSided={mat.get('doubleSided', False)} baseColorTexture={'baseColorTexture' in pbr}")
    for i, im in enumerate(g.get("images", [])):
        bv = g["bufferViews"][im["bufferView"]] if "bufferView" in im else None
        size = bv["byteLength"] if bv else None
        dims = None
        if bv:
            blob = binblob[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
            if blob[:8] == b"\x89PNG\r\n\x1a\n":
                dims = struct.unpack(">II", blob[16:24])
            elif blob[:2] == b"\xff\xd8":
                j = 2
                while j < len(blob):
                    if blob[j] != 0xFF:
                        j += 1
                        continue
                    marker = blob[j + 1]
                    if marker in (0xC0, 0xC1, 0xC2):
                        h, w = struct.unpack(">HH", blob[j + 5:j + 9])
                        dims = (w, h)
                        break
                    seg = struct.unpack(">H", blob[j + 2:j + 4])[0]
                    j += 2 + seg
        print(f"image[{i}] {im.get('name')} {im.get('mimeType')} bytes={size} dims={dims}")
    # rest-pose world-space direction of DEF-upper_arm.L: from its node to its first child's node
    nodes = g.get("nodes", [])
    by_name = {n.get("name"): i for i, n in enumerate(nodes)}
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i

    def world(i):
        import math
        # compose TRS along parent chain
        def trs(n):
            t = n.get("translation", [0, 0, 0])
            r = n.get("rotation", [0, 0, 0, 1])
            s = n.get("scale", [1, 1, 1])
            return t, r, s

        def qmul(a, b):
            ax, ay, az, aw = a
            bx, by, bz, bw = b
            return [aw * bx + ax * bw + ay * bz - az * by,
                    aw * by - ax * bz + ay * bw + az * bx,
                    aw * bz + ax * by - ay * bx + az * bw,
                    aw * bw - ax * bx - ay * by - az * bz]

        def rot(q, v):
            qv = [v[0], v[1], v[2], 0]
            qc = [-q[0], -q[1], -q[2], q[3]]
            return qmul(qmul(q, qv), qc)[:3]

        chain = []
        j = i
        while j is not None:
            chain.append(j)
            j = parent.get(j)
        pos = [0, 0, 0]
        q = [0, 0, 0, 1]
        sc = 1.0
        for j in chain:  # child first; apply parent-most last => iterate reversed
            pass
        for j in reversed(chain):
            t, r, s = trs(nodes[j])
            pos = [pos[k] + rot(q, [t[k] * sc for k in range(3)])[k] for k in range(3)]
            q = qmul(q, r)
            sc *= s[0]
        return pos

    for bone in ("DEF-upper_arm.L", "DEF-upper_arm.R", "DEF-thigh.L", "DEF-spine", "DEF-spine.006"):
        if bone in by_name:
            i = by_name[bone]
            p = world(i)
            kids = nodes[i].get("children", [])
            if kids:
                c = world(kids[0])
                d = [c[k] - p[k] for k in range(3)]
                n = sum(x * x for x in d) ** 0.5
                d = [round(x / n, 4) for x in d]
            else:
                d = None
            print(f"node {bone}: world head={[round(x, 4) for x in p]} dir_to_child={d} child={nodes[kids[0]].get('name') if kids else None}")
    top = [i for i in range(len(nodes)) if i not in parent]
    print("root nodes:", [nodes[i].get("name") for i in top])


if __name__ == "__main__":
    main(sys.argv[1])
