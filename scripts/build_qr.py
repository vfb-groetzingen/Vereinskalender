#!/usr/bin/env python3
"""Erzeugt je Raum bzw. Platz einen QR-Code (SVG) mit dem dauerhaften Link zum Kalender.

Quelle: data/seed.json (settings.public_base_url und resources).
Ausgabe: qr/<slug>.svg

Aufruf:  python3 scripts/build_qr.py
Wird außerdem automatisch von .github/workflows/qr.yml ausgeführt,
sobald sich data/seed.json ändert.
"""
import json
import pathlib
import sys

import qrcode
from qrcode.image.svg import SvgPathImage

ROOT = pathlib.Path(__file__).resolve().parent.parent
seed = json.loads((ROOT / "data" / "seed.json").read_text(encoding="utf-8"))
base = seed["settings"]["public_base_url"].rstrip("/")

if "DEIN-GITHUB-NAME" in base:
    print("Warnung: settings.public_base_url in data/seed.json ist noch der Platzhalter. "
          "Bitte die eigene GitHub-Pages-Adresse eintragen und die QR-Codes neu erzeugen.", file=sys.stderr)

out = ROOT / "qr"
out.mkdir(exist_ok=True)

count = 0
for res in seed["resources"]:
    url = f"{base}/raeume/{res['slug']}"
    img = qrcode.make(url, image_factory=SvgPathImage, box_size=10, border=4)
    with open(out / f"{res['slug']}.svg", "wb") as fh:
        img.save(fh)
    count += 1
    print(f"QR-Code erstellt: {res['slug']}.svg -> {url}")

print(f"Fertig: {count} QR-Codes in {out}")
