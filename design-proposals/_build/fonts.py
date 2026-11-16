"""Make the font files each proposal uses.

The website loads the variable TTFs as they ship. Satori (the Discord and social images) accepts
static TTF/OTF only and applies no OpenType features, so for it we cut static instances and
freeze `tnum` into the default digits, so that scores and tables line up in the images too.

Run with the local venv: _tools/venv/bin/python -I _build/fonts.py
"""

import copy
import os
import shutil
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_fonts", "src")

PROPOSALS = {
    "a-reference": {
        "web": ["IBMPlexSans[wdth,wght].ttf", "IBMPlexMono-Regular.ttf"],
        "licence": "OFL-IBMPlexSans.txt",
        "satori": [
            ("IBMPlexSans[wdth,wght].ttf", {"wght": 400, "wdth": 100}, "IBMPlexSans-Regular.ttf"),
            ("IBMPlexSans[wdth,wght].ttf", {"wght": 600, "wdth": 100}, "IBMPlexSans-SemiBold.ttf"),
            ("IBMPlexSans[wdth,wght].ttf", {"wght": 600, "wdth": 85}, "IBMPlexSansCondensed-SemiBold.ttf"),
        ],
    },
    "b-league": {
        "web": ["Archivo[wdth,wght].ttf"],
        "licence": "OFL-Archivo.txt",
        "satori": [
            ("Archivo[wdth,wght].ttf", {"wght": 400, "wdth": 100}, "Archivo-Regular.ttf"),
            ("Archivo[wdth,wght].ttf", {"wght": 600, "wdth": 100}, "Archivo-SemiBold.ttf"),
            ("Archivo[wdth,wght].ttf", {"wght": 800, "wdth": 62}, "Archivo-ExtraCondensedExtraBold.ttf"),
        ],
    },
    "c-app": {
        "web": ["SchibstedGrotesk[wght].ttf"],
        "licence": "OFL-SchibstedGrotesk.txt",
        "satori": [
            ("SchibstedGrotesk[wght].ttf", {"wght": 400}, "SchibstedGrotesk-Regular.ttf"),
            ("SchibstedGrotesk[wght].ttf", {"wght": 600}, "SchibstedGrotesk-SemiBold.ttf"),
            ("SchibstedGrotesk[wght].ttf", {"wght": 800}, "SchibstedGrotesk-ExtraBold.ttf"),
        ],
    },
}


def freeze_tnum(font: TTFont) -> bool:
    """Point the cmap's digits at their tabular glyphs. Returns False when the font has no tnum."""
    if "GSUB" not in font or not font["GSUB"].table.FeatureList:
        return False
    table = font["GSUB"].table
    mapping: dict[str, str] = {}
    for record in table.FeatureList.FeatureRecord:
        if record.FeatureTag != "tnum":
            continue
        for index in record.Feature.LookupListIndex:
            lookup = table.LookupList.Lookup[index]
            for sub in lookup.SubTable:
                inner = sub.ExtSubTable if lookup.LookupType == 7 else sub
                if hasattr(inner, "mapping"):
                    mapping.update(inner.mapping)
    if not mapping:
        return False
    for cmap in font["cmap"].tables:
        for code, glyph in list(cmap.cmap.items()):
            if glyph in mapping:
                cmap.cmap[code] = mapping[glyph]
    return True


for proposal, spec in PROPOSALS.items():
    web_dir = os.path.join(ROOT, proposal, "fonts")
    satori_dir = os.path.join(web_dir, "satori")
    os.makedirs(satori_dir, exist_ok=True)
    for name in spec["web"]:
        shutil.copy(os.path.join(SRC, name), os.path.join(web_dir, name.replace("[", "-").replace("]", "").replace(",", "-")))
    shutil.copy(os.path.join(SRC, spec["licence"]), os.path.join(web_dir, "OFL.txt"))
    for source, location, out in spec["satori"]:
        font = TTFont(os.path.join(SRC, source))
        static = instantiateVariableFont(copy.deepcopy(font), location, updateFontNames=False)
        frozen = freeze_tnum(static)
        static.save(os.path.join(satori_dir, out))
        print(f"{proposal}: {out} (tnum frozen: {frozen})")
