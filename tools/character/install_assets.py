"""Install the CC0 makehuman_system_assets pack into MPFB's user data directory.

Run headless:

    $BL -b --python tools/character/install_assets.py -- --zip /path/to/makehuman_system_assets_cc0.zip

The zip (about 280 MB) is downloaded by the caller (see README.md):

    curl -L -C - -o makehuman_system_assets_cc0.zip \
      https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip

The URL is the direct download link on MPFB's URL_SYSTEM_ASSETS page
(src/mpfb/ui/weburls.py -> https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html).
The pack is extracted with AssetService.fix_and_extract_asset_pack_zip(), which
copies its `packs/`, `skins/`, `eyes/`, ... folders into LocationService.get_user_data(),
then the pack metadata is rescanned and the install verified.
"""
import argparse
import importlib
import os
import sys


def dynamic_import(absolute_package_str, key):
    """Quirk to get around blender's extension format's requirement that all imports must be relative"""
    for amod in list(sys.modules):
        if amod.endswith(absolute_package_str):
            mpfb_mod = importlib.import_module(amod)
            if not hasattr(mpfb_mod, key):
                raise AttributeError(f"Module {amod} does not have attribute {key}")
            return getattr(mpfb_mod, key)
    raise ValueError(f"No module found with name ending in {absolute_package_str}")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Install makehuman_system_assets into MPFB")
    p.add_argument("--zip", required=True, help="path to makehuman_system_assets_cc0.zip")
    p.add_argument("--force", action="store_true", help="re-extract even if the pack is already installed")
    return p.parse_args(argv)


def main():
    args = parse_args()
    AssetService = dynamic_import("mpfb.services.assetservice", "AssetService")
    LocationService = dynamic_import("mpfb.services.locationservice", "LocationService")

    user_data = LocationService.get_user_data()
    print("MPFB user data dir:", user_data)

    if AssetService.system_assets_pack_is_installed() and not args.force:
        print("makehuman_system_assets already installed; nothing to do (use --force to re-extract)")
        return

    if not os.path.isfile(args.zip):
        raise SystemExit(f"zip not found: {args.zip}")
    size = os.path.getsize(args.zip)
    print(f"extracting {args.zip} ({size / 1e6:.1f} MB) into {user_data}")
    os.makedirs(user_data, exist_ok=True)
    err = AssetService.fix_and_extract_asset_pack_zip(args.zip, user_data)
    if err:
        raise SystemExit(f"extraction failed: {err}")

    AssetService.rescan_pack_metadata()
    ok = AssetService.system_assets_pack_is_installed()
    print("pack names:", AssetService.get_pack_names())
    print("system_assets_pack_is_installed:", ok)
    if not ok:
        raise SystemExit("pack extracted but not detected; check packs/*.json under " + user_data)

    for fname, subdir in [("young_asian_male.mhmat", "skins"), ("low-poly.mhclo", "eyes"),
                          ("eyebrow001.mhclo", "eyebrows"), ("eyelashes01.mhclo", "eyelashes")]:
        print(f"  {subdir}/{fname}: {AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)}")


if __name__ == "__main__":
    main()
