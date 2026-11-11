#!/usr/bin/env python3
"""Send annual event emails at 06:00 Europe/Berlin via Strato SMTP."""
import datetime as dt
import email.policy
import html
from html.parser import HTMLParser
import json
import os
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formataddr
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

MAX_BYTES = 5 * 1024 * 1024
TZ = ZoneInfo("Europe/Berlin")
FROM_EMAIL = "vfb-app@vfb-groetzingen.de"
FROM_NAME = "VfB Grötzingen (Kalender)"
ALLOWED_TAGS = {"p", "div", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "h2", "h3", "blockquote", "a", "img"}


def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"GitHub Secret fehlt: {name}")
    return value


SUPABASE_URL = required_env("SUPABASE_URL").rstrip("/")
SERVICE_KEY = required_env("SUPABASE_SERVICE_ROLE_KEY")
SMTP_USER = required_env("STRATO_SMTP_USER")
SMTP_PASSWORD = required_env("STRATO_SMTP_PASSWORD")


def api(method, path, body=None, prefer=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Accept": "application/json",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    request = Request(f"{SUPABASE_URL}/rest/v1/{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            payload = response.read()
            return json.loads(payload.decode("utf-8")) if payload else None
    except HTTPError as exc:
        detail = exc.read(1500).decode("utf-8", "replace")
        raise RuntimeError(f"Supabase API {exc.code}: {detail}") from exc


def download_asset(path, event_id):
    if not isinstance(path, str) or not path.startswith(f"{event_id}/") or ".." in path.split("/"):
        raise RuntimeError("Ungültiger Anhangspfad")
    encoded = quote(path, safe="/")
    request = Request(
        f"{SUPABASE_URL}/storage/v1/object/annual-event-files/{encoded}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    try:
        with urlopen(request, timeout=40) as response:
            data = response.read(MAX_BYTES + 1)
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"Anhang konnte nicht geladen werden: {path}") from exc
    if len(data) > MAX_BYTES:
        raise RuntimeError("Ein Anhang überschreitet 5 MB")
    return data


class SafeHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.stack = []
        self.suppress = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "iframe", "object"}:
            self.suppress += 1
            return
        if self.suppress or tag not in ALLOWED_TAGS:
            return
        attrs = dict(attrs)
        if tag == "a":
            href = attrs.get("href", "")
            if href.lower().startswith(("https://", "http://", "mailto:")):
                self.parts.append(f'<a href="{html.escape(href, quote=True)}" rel="noopener noreferrer">')
            else:
                self.parts.append("<a>")
        elif tag == "img":
            src = attrs.get("src", "")
            alt = attrs.get("alt", "")
            cid = src[4:] if src.lower().startswith("cid:") else ""
            if re.fullmatch(r"[A-Za-z0-9._-]{1,100}", cid):
                self.parts.append(f'<img src="cid:{html.escape(cid, quote=True)}" alt="{html.escape(alt, quote=True)}">')
        elif tag == "br":
            self.parts.append("<br>")
        else:
            self.parts.append(f"<{tag}>")
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in {"script", "style", "iframe", "object"} and self.suppress:
            self.suppress -= 1
            return
        if self.suppress:
            return
        if tag in self.stack:
            # Close any nested tags in order to keep valid, safe markup.
            while self.stack:
                opened = self.stack.pop()
                self.parts.append(f"</{opened}>")
                if opened == tag:
                    break

    def handle_data(self, data):
        if not self.suppress:
            self.parts.append(html.escape(data))

    def result(self):
        while self.stack:
            self.parts.append(f"</{self.stack.pop()}>")
        return "".join(self.parts)


def sanitize_html(source):
    parser = SafeHTML()
    parser.feed(source or "")
    parser.close()
    return parser.result()


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(source):
    parser = PlainText()
    parser.feed(source or "")
    parser.close()
    text = " ".join(" ".join(parser.parts).split())
    return text or "Diese Nachricht enthält eine formatierte E-Mail."


def parse_mime(content_type):
    main, _, sub = (content_type or "application/octet-stream").partition("/")
    if main not in {"application", "audio", "image", "text", "video"}:
        return "application", "octet-stream"
    return main, sub.split(";", 1)[0] or "octet-stream"


def build_message(event, recipient):
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient or ""):
        raise RuntimeError("Ungültige Empfängeradresse")
    subject = event.get("subject", "")
    if not subject.strip() or "\r" in subject or "\n" in subject:
        raise RuntimeError("Ungültige Betreffzeile")
    assets = event.get("assets") or []
    total = sum(int(asset.get("size") or 0) for asset in assets)
    if total > MAX_BYTES:
        raise RuntimeError("Die Gesamtgröße der Anhänge überschreitet 5 MB")
    body_html = sanitize_html(event.get("body_html", ""))
    message = EmailMessage(policy=email.policy.SMTP)
    message["From"] = formataddr((FROM_NAME, FROM_EMAIL))
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(plain_text(body_html))
    message.add_alternative(body_html, subtype="html")
    html_part = message.get_body(preferencelist=("html",))
    for asset in assets:
        content = download_asset(asset.get("path"), event["id"])
        maintype, subtype = parse_mime(asset.get("content_type"))
        filename = os.path.basename(asset.get("filename") or "Anhang")
        if asset.get("inline") and asset.get("cid"):
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", asset["cid"]):
                raise RuntimeError("Ungültige Bildkennung im eingebetteten Bild")
            html_part.add_related(content, maintype=maintype, subtype=subtype,
                                  cid=f"<{asset['cid']}>", filename=filename, disposition="inline")
        else:
            message.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)
    return message


def upsert_delivery(event_id, year, recipient, status, sent_at=None, error=None):
    row = {
        "event_id": event_id,
        "occurrence_year": year,
        "recipient": recipient,
        "status": status,
        "sent_at": sent_at,
        "error": (error or "")[:1000] or None,
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    api("POST", "annual_email_deliveries?on_conflict=event_id,occurrence_year,recipient", [row],
        "resolution=merge-duplicates,return=minimal")


def main():
    now = dt.datetime.now(TZ)
    # GitHub Actions runs at 04:00 and 05:00 UTC to cover CET/CEST. Never send early.
    if now.hour < 6:
        print(f"Noch vor 06:00 Uhr in Europe/Berlin ({now.isoformat()}); kein Versand.")
        return
    query = (
        "annual_email_events?select=id,title,event_month,event_day,recipients,subject,body_html,assets"
        f"&event_month=eq.{now.month}&event_day=eq.{now.day}&active=eq.true"
    )
    events = api("GET", query) or []
    if not events:
        print(f"Keine aktiven Ereignisse am {now.strftime('%d.%m.')}.")
        return
    smtp = None
    try:
        smtp = smtplib.SMTP_SSL("smtp.strato.de", 465, timeout=35, context=ssl.create_default_context())
        smtp.login(SMTP_USER, SMTP_PASSWORD)
        for event in events:
            year = now.year
            try:
                previous = api(
                    "GET",
                    "annual_email_deliveries?select=recipient,status"
                    f"&event_id=eq.{event['id']}&occurrence_year=eq.{year}",
                ) or []
                sent = {row["recipient"].lower() for row in previous if row.get("status") == "sent"}
                for recipient in event.get("recipients") or []:
                    if recipient.lower() in sent:
                        print(f"Bereits versendet: Ereignis {event['id']} an {recipient}")
                        continue
                    try:
                        upsert_delivery(event["id"], year, recipient, "sending")
                        message = build_message(event, recipient)
                        smtp.send_message(message)
                        upsert_delivery(event["id"], year, recipient, "sent", dt.datetime.now(dt.timezone.utc).isoformat())
                        print(f"Versendet: Ereignis {event['id']} an {recipient}")
                    except Exception as exc:  # keep processing other recipients/events
                        upsert_delivery(event["id"], year, recipient, "failed", error=str(exc))
                        print(f"FEHLER für Ereignis {event['id']} / {recipient}: {exc}", file=sys.stderr)
            except Exception as exc:
                print(f"FEHLER für Ereignis {event.get('id')}: {exc}", file=sys.stderr)
    finally:
        if smtp:
            try:
                smtp.quit()
            except Exception:
                pass


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Versandlauf fehlgeschlagen: {error}", file=sys.stderr)
        sys.exit(1)
