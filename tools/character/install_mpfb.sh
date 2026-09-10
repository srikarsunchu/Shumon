#!/usr/bin/env bash
# Install the MPFB2 (MakeHuman Plugin For Blender) extension into Blender and
# enable the bundled Rigify add-on. Idempotent: re-running rebuilds and
# reinstalls the extension from a fresh shallow clone.
#
# Usage: tools/character/install_mpfb.sh [SCRATCH_DIR]
#   BLENDER   path to the Blender binary (default: /Applications/Blender.app/Contents/MacOS/Blender)
#   SCRATCH   directory for the clone and the built zip (default: $1 or ./.scratch/mpfb)
set -euo pipefail

BL="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
SCRATCH="${1:-${SCRATCH:-$(pwd)/.scratch/mpfb}}"
CLONE="$SCRATCH/mpfb2"
mkdir -p "$SCRATCH"

if [ ! -x "$BL" ]; then
  echo "Blender not found at $BL (set BLENDER=...)" >&2
  exit 1
fi
"$BL" --version | head -1

if [ ! -d "$CLONE/src/mpfb" ]; then
  echo "== cloning mpfb2 into $CLONE"
  git clone --depth 1 https://github.com/makehumancommunity/mpfb2 "$CLONE"
else
  echo "== reusing existing clone at $CLONE"
fi

# The extension manifest lives in src/mpfb/blender_manifest.toml, so that
# directory is the --source-dir for `extension build`.
if [ ! -f "$CLONE/src/mpfb/blender_manifest.toml" ]; then
  echo "blender_manifest.toml not found under $CLONE/src/mpfb; layout changed?" >&2
  find "$CLONE" -name blender_manifest.toml >&2
  exit 1
fi

echo "== building extension zip"
rm -f "$SCRATCH"/mpfb-*.zip
"$BL" -b --command extension build --source-dir "$CLONE/src/mpfb" --output-dir "$SCRATCH"
ZIP="$(ls -1 "$SCRATCH"/mpfb-*.zip | head -1)"
echo "built $ZIP"

echo "== installing into user_default repo (enabled)"
"$BL" -b --command extension install-file "$ZIP" -r user_default -e

echo "== enabling rigify and saving user preferences"
"$BL" -b --python-expr "import addon_utils, bpy
addon_utils.enable('rigify', default_set=True, persistent=True)
addon_utils.enable('bl_ext.user_default.mpfb', default_set=True, persistent=True)
bpy.ops.wm.save_userpref()
print('enabled:', [m for m in bpy.context.preferences.addons.keys() if 'rigify' in m or 'mpfb' in m])"

echo "== installed extensions"
"$BL" -b --command extension list | grep -i -A2 "mpfb" || true

echo "== smoke test: import MPFB services headless"
"$BL" -b --python-expr "import importlib, sys
mods=[m for m in sys.modules if m.endswith('mpfb.services.humanservice')]
print('humanservice module:', mods)
assert mods, 'MPFB not importable'
import addon_utils
print('rigify enabled:', any(m.__name__=='rigify' for m in addon_utils.modules() if addon_utils.check(m.__name__)[1]))"
echo "== done"
