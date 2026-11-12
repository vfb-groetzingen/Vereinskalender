#!/usr/bin/env python3
"""Delete expired one-time event records and files through the Supabase APIs."""
import datetime as dt
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"GitHub Secret fehlt: {name}")
    return value


SUPABASE_URL = required_env("SUPABASE_URL").rstrip("/")
SERVICE_KEY = required_env("SUPABASE_SERVICE_ROLE_KEY")
BUCKET = "annual-event-files"
PAGE_SIZE = 500


def headers(json_body=False):
    result = {"apikey": SERVICE_KEY, "Accept": "application/json"}
    if not SERVICE_KEY.startswith("sb_secret_"):
        result["Authorization"] = f"Bearer {SERVICE_KEY}"
    if json_body:
        result["Content-Type"] = "application/json"
    return result


def request_json(method, path, body=None, prefer=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request_headers = headers(json_body=data is not None)
    if prefer:
        request_headers["Prefer"] = prefer
    request = Request(f"{SUPABASE_URL}/rest/v1/{path}", data=data, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=35) as response:
            payload = response.read()
            return json.loads(payload.decode("utf-8")) if payload else None
    except HTTPError as exc:
        detail = exc.read(1500).decode("utf-8", "replace")
        raise RuntimeError(f"Supabase API {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Supabase-Verbindung fehlgeschlagen: {exc}") from exc


def delete_storage_objects(paths):
    if not paths:
        return
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}"
    data = json.dumps({"prefixes": paths}).encode("utf-8")
    request = Request(url, data=data, headers=headers(json_body=True), method="DELETE")
    try:
        with urlopen(request, timeout=45) as response:
            response.read()
    except HTTPError as exc:
        detail = exc.read(1500).decode("utf-8", "replace")
        raise RuntimeError(f"Supabase Storage API {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Supabase Storage-Verbindung fehlgeschlagen: {exc}") from exc


def cutoff_date(today=None):
    today = today or dt.date.today()
    year = today.year - 3
    try:
        return today.replace(year=year)
    except ValueError:  # 29 February three years earlier
        return today.replace(year=year, day=28)


def expired_events(cutoff):
    result = []
    offset = 0
    while True:
        path = (
            "annual_email_events?select=id,event_date,assets"
            f"&recurrence=eq.once&event_date=lt.{cutoff.isoformat()}"
            f"&order=event_date.asc&limit={PAGE_SIZE}&offset={offset}"
        )
        page = request_json("GET", path) or []
        result.extend(page)
        if len(page) < PAGE_SIZE:
            return result
        offset += PAGE_SIZE


def asset_paths(event):
    paths = []
    event_id = event["id"]
    for asset in event.get("assets") or []:
        path = asset.get("path") if isinstance(asset, dict) else None
        if not path:
            continue
        if not isinstance(path, str) or not path.startswith(f"{event_id}/") or ".." in path.split("/"):
            raise RuntimeError(f"Ungültiger Dateipfad beim Ereignis {event_id}")
        paths.append(path)
    return sorted(set(paths))


def delete_event(event, cutoff):
    paths = asset_paths(event)
    delete_storage_objects(paths)
    event_id = quote(event["id"], safe="")
    path = (
        f"annual_email_events?id=eq.{event_id}&recurrence=eq.once"
        f"&event_date=lt.{cutoff.isoformat()}"
    )
    deleted = request_json("DELETE", path, prefer="return=representation") or []
    return bool(deleted)


def main():
    cutoff = cutoff_date()
    events = expired_events(cutoff)
    if not events:
        print(f"Keine einmaligen Ereignisse vor der Aufbewahrungsgrenze {cutoff}.")
        return
    failures = 0
    for event in events:
        try:
            if delete_event(event, cutoff):
                print(f"Abgelaufenes Ereignis samt Dateien gelöscht: {event['id']} ({event.get('event_date')})")
            else:
                print(f"Ereignis wurde inzwischen geändert oder entfernt: {event['id']}")
        except Exception as exc:
            failures += 1
            print(f"Löschen fehlgeschlagen für Ereignis {event.get('id')}: {exc}", file=sys.stderr)
    if failures:
        raise RuntimeError(f"{failures} abgelaufene Ereignisse konnten nicht vollständig gelöscht werden.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Bereinigung fehlgeschlagen: {error}", file=sys.stderr)
        sys.exit(1)
