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


def api_headers():
    headers = {"apikey": SERVICE_KEY}
    # New Supabase secret API keys are not JWTs: send them only as apikey.
    # The legacy service_role key is a JWT and also belongs in Authorization.
    if not SERVICE_KEY.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {SERVICE_KEY}"
    return headers


def api(method, path, body=None, prefer=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {**api_headers(), "Accept": "application/json"}
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
        headers=api_headers(),
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


def upsert_delivery(event, event_date, recipient, status, sent_at=None, error=None):
    row = {
        "event_id": event["id"],
        "event_title": event.get("title"),
        "recurrence": event.get("recurrence") or "annual",
        "event_date": event_date.isoformat(),
        "occurrence_year": event_date.year,
        "recipient": recipient,
        "status": status,
        "sent_at": sent_at,
        "error": (error or "")[:1000] or None,
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    api("POST", "annual_email_deliveries?on_conflict=event_id,occurrence_year,recipient", [row],
        "resolution=merge-duplicates,return=minimal")


def smtp_connect():
    smtp = smtplib.SMTP_SSL("smtp.strato.de", 465, timeout=35, context=ssl.create_default_context())
    smtp.login(SMTP_USER, SMTP_PASSWORD)
    return smtp


def send_checked(smtp, message, recipient):
    refused = smtp.send_message(message)
    if recipient in refused:
        code, reason = refused[recipient]
        if isinstance(reason, bytes):
            reason = reason.decode("utf-8", "replace")
        raise RuntimeError(f"SMTP hat die Empfängeradresse abgelehnt ({code}): {reason}")
    return refused


def update_test_request(request_id, status, error=None, event=None):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    row = {
        "status": status,
        "processed_at": now if status in {"sent", "failed"} else None,
        "updated_at": now,
        "error": (error or "")[:1000] or None,
    }
    if event:
        row.update({
            "event_title": event.get("title"),
            "recurrence": event.get("recurrence") or "annual",
            "event_date": event.get("event_date"),
            "event_month": event.get("event_month"),
            "event_day": event.get("event_day"),
        })
    api("PATCH", f"annual_email_test_requests?id=eq.{request_id}", row, "return=minimal")


def claim_test_request():
    rows = api("POST", "rpc/claim_annual_email_test_request", {}) or []
    return rows[0] if rows else None


def process_test_requests():
    pending = api("GET", "annual_email_test_requests?select=id&status=eq.pending&limit=1") or []
    if not pending:
        print("Keine Testmail-Anfragen in der Warteschlange.")
        return
    try:
        smtp = smtp_connect()
    except Exception as exc:
        error = f"SMTP-Verbindung fehlgeschlagen: {exc}"
        while True:
            request = claim_test_request()
            if not request:
                break
            update_test_request(request["id"], "failed", error)
            print(f"Testmail fehlgeschlagen für {request.get('recipient')}: {error}", file=sys.stderr)
        return
    try:
        while True:
            request = claim_test_request()
            if not request:
                break
            request_id = request["id"]
            event = None
            try:
                events = api(
                    "GET",
                    "annual_email_events?select=id,title,recurrence,event_date,event_month,event_day,subject,body_html,assets"
                    f"&id=eq.{request['event_id']}&limit=1",
                ) or []
                if not events:
                    raise RuntimeError("Das zugehörige Ereignis wurde nicht gefunden.")
                event = dict(events[0])
                update_test_request(request_id, "sending", event=event)
                event["subject"] = "[TEST] " + event["subject"]
                event["body_html"] = (
                    '<p><strong>Dies ist eine Testmail. Es wurde noch keine reguläre Ereignis-E-Mail versendet.</strong></p>'
                    + event.get("body_html", "")
                )
                message = build_message(event, request["recipient"])
                send_checked(smtp, message, request["recipient"])
                update_test_request(request_id, "sent", event=event)
                print(f"Testmail vom SMTP-Server angenommen: {request['recipient']}")
            except Exception as exc:
                error = str(exc)[:1000]
                update_test_request(request_id, "failed", error, event=event)
                print(f"Testmail fehlgeschlagen für {request.get('recipient')}: {error}", file=sys.stderr)
    finally:
        try:
            smtp.quit()
        except Exception:
            pass


def previous_delivery_statuses(event_id, year):
    return api(
        "GET",
        "annual_email_deliveries?select=recipient,status"
        f"&event_id=eq.{event_id}&occurrence_year=eq.{year}",
    ) or []


def event_occurs_on(event, date):
    recurrence = event.get("recurrence") or "annual"
    if recurrence == "once":
        return event.get("event_date") == date.isoformat()
    if recurrence == "annual":
        try:
            return int(event.get("event_month")) == date.month and int(event.get("event_day")) == date.day
        except (TypeError, ValueError):
            return False
    return False


def main():
    if "--tests-only" in sys.argv:
        process_test_requests()
        return
    now = dt.datetime.now(TZ)
    # GitHub Actions runs at 04:00 and 05:00 UTC to cover CET/CEST. Never send early.
    if now.hour < 6:
        print(f"Noch vor 06:00 Uhr in Europe/Berlin ({now.isoformat()}); kein Versand.")
        return
    query = (
        "annual_email_events?select=id,title,recurrence,event_date,event_month,event_day,recipients,subject,body_html,assets"
        "&active=eq.true"
    )
    events = [event for event in (api("GET", query) or []) if event_occurs_on(event, now.date())]
    if not events:
        print(f"Keine aktiven Ereignisse am {now.strftime('%d.%m.')}.")
        return

    event_date = now.date()
    year = event_date.year
    try:
        smtp = smtp_connect()
    except Exception as exc:
        error = f"SMTP-Verbindung fehlgeschlagen: {exc}"
        for event in events:
            try:
                previous = previous_delivery_statuses(event["id"], year)
                handled = {row["recipient"].lower() for row in previous if row.get("status") in {"sent", "sending"}}
                for recipient in event.get("recipients") or []:
                    if recipient.lower() not in handled:
                        upsert_delivery(event, event_date, recipient, "failed", error=error)
            except Exception as log_error:
                print(f"Fehler konnte nicht protokolliert werden: {log_error}", file=sys.stderr)
        print(error, file=sys.stderr)
        return

    try:
        for event in events:
            try:
                previous = previous_delivery_statuses(event["id"], year)
                handled = {row["recipient"].lower() for row in previous if row.get("status") in {"sent", "sending"}}
                for recipient in event.get("recipients") or []:
                    if recipient.lower() in handled:
                        print(f"Bereits versendet oder in Bearbeitung: Ereignis {event['id']} an {recipient}")
                        continue
                    handled.add(recipient.lower())
                    try:
                        upsert_delivery(event, event_date, recipient, "sending")
                        message = build_message(event, recipient)
                        send_checked(smtp, message, recipient)
                        upsert_delivery(event, event_date, recipient, "sent", dt.datetime.now(dt.timezone.utc).isoformat())
                        print(f"Versendet: Ereignis {event['id']} an {recipient}")
                    except Exception as exc:
                        try:
                            upsert_delivery(event, event_date, recipient, "failed", error=str(exc))
                        except Exception as log_error:
                            print(f"Versandfehler konnte nicht protokolliert werden: {log_error}", file=sys.stderr)
                        print(f"FEHLER für Ereignis {event['id']} / {recipient}: {exc}", file=sys.stderr)
            except Exception as exc:
                print(f"FEHLER für Ereignis {event.get('id')}: {exc}", file=sys.stderr)
    finally:
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
