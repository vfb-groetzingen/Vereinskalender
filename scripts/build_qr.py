#!/usr/bin/env python3
"""Erzeugt je Ressource einen unveränderlichen Kalender-QR als SVG und PNG.

Die URL enthält ausschließlich public_base_url und den stabilen Ressourcen-Slug,
niemals den veränderbaren Anzeigenamen.
Quelle: data/seed.json
Ausgabe: qr/<slug>.svg und qr/<slug>.png
"""
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

import qrcode
from qrcode.image.svg import SvgPathImage

ROOT = pathlib.Path(__file__).resolve().parent.parent
seed = json.loads((ROOT / "data" / "seed.json").read_text(encoding="utf-8"))
base = seed["settings"]["public_base_url"].rstrip("/")
seed_resources = seed.get("resources", [])
source = os.environ.get("QR_SOURCE", "seed").lower()
if source not in {"seed", "supabase", "auto"}:
    raise SystemExit("QR_SOURCE muss seed, supabase oder auto sein.")
supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
supabase_key = os.environ.get("SUPABASE_ANON_KEY", "")

if not base.startswith("https://"):
    raise SystemExit("settings.public_base_url muss mit https:// beginnen.")
if "DEIN-GITHUB-NAME" in base:
    raise SystemExit("public_base_url ist noch der Platzhalter. Adresse eintragen und erneut starten.")

use_database = source == "supabase" or (source == "auto" and bool(supabase_url or supabase_key))
if use_database:
    if not supabase_url or not supabase_key:
        raise SystemExit("Für QR_SOURCE=supabase müssen SUPABASE_URL und SUPABASE_ANON_KEY gesetzt sein.")
    request = urllib.request.Request(
        supabase_url + "/rest/v1/resources?select=slug&order=slug.asc",
        headers={"apikey": supabase_key, "Authorization": "Bearer " + supabase_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            resources = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read(1000).decode("utf-8", errors="replace")
        raise SystemExit(f"Supabase lieferte HTTP {error.code}: {detail}") from error
    except Exception as error:
        raise SystemExit(f"Ressourcen konnten nicht aus Supabase geladen werden: {error}") from error
    print(f"QR-Quelle: Supabase ({len(resources)} Ressourcen; Anzeigenamen beeinflussen die Links nicht).")
else:
    resources = seed_resources
    print(f"QR-Quelle: data/seed.json ({len(resources)} Ressourcen).")

if not resources:
    raise SystemExit("Keine Ressourcen zum Erzeugen der QR-Codes gefunden.")

slugs = [resource.get("slug", "") for resource in resources]
if len(slugs) != len(set(slugs)):
    raise SystemExit("Ressourcen-Slugs müssen eindeutig sein.")
for slug in slugs:
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        raise SystemExit(f"Ungültiger oder fehlender Ressourcen-Slug: {slug!r}")

out = ROOT / "qr"
out.mkdir(exist_ok=True)
count = 0
for resource in resources:
    slug = resource["slug"]
    url = f"{base}/raeume/{slug}"

    # SVG ist vektorbasiert. Der Anzeigename wird nicht in den dauerhaften QR-Link codiert.
    svg = qrcode.make(
        url,
        image_factory=SvgPathImage,
        box_size=10,
        border=4,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
    )
    svg.save(out / f"{slug}.svg")

    # 30 Pixel je Modul ergeben eine hochauflösende PNG-Version für den A4-Druck.
    png = qrcode.make(
        url,
        box_size=30,
        border=4,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
    )
    png.save(out / f"{slug}.png", format="PNG")

    count += 1
    print(f"QR-Code erstellt: {slug}.svg und {slug}.png -> {url}")

print(f"Fertig: {count} Ressourcen mit SVG- und PNG-QR-Codes in {out}")
