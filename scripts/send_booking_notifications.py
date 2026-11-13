#!/usr/bin/env python3
"""Send booking confirmations, changes, cancellations and reminders through Strato SMTP."""
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

TZ = ZoneInfo("Europe/Berlin")
FROM_EMAIL = "vfb-app@vfb-groetzingen.de"
FROM_FALLBACK_NAME = "VfB Grötzingen"
DEFAULT_SIGNATURE = "Mit freundlichen Grüßen\nVfB Grötzingen\n\nInternet: http://www.vfb-groetzingen.de/"
DEFAULT_TEMPLATES = {
    "confirmation": {
        "subject": "Buchungsbestätigung: {{title}}",
        "body": "Guten Tag,\n\nIhre Buchung wurde eingetragen.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}",
    },
    "changed": {
        "subject": "Änderung Ihrer Buchung: {{title}}",
        "body": "Guten Tag,\n\nIhre Buchung wurde geändert.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}",
    },
    "cancelled": {
        "subject": "Absage Ihrer Buchung: {{title}}",
        "body": "Guten Tag,\n\nIhre Buchung wurde abgesagt.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}",
    },
    "reminder": {
        "subject": "Erinnerung: {{title}}",
        "body": "Guten Tag,\n\nhiermit erinnern wir an Ihre bevorstehende Buchung.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}",
    },
}


def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"GitHub Secret fehlt: {name}")
    return value


SUPABASE_URL = required_env("SUPABASE_URL").rstrip("/")
SERVICE_KEY = required_env("SUPABASE_SERVICE_ROLE_KEY")
SMTP_USER = required_env("STRATO_SMTP_USER")
SMTP_PASSWORD = required_env("STRATO_SMTP_PASSWORD")
if SMTP_USER.casefold() != FROM_EMAIL.casefold():
    raise RuntimeError(f"STRATO_SMTP_USER muss das authentifizierte Postfach {FROM_EMAIL} sein.")


def api_headers():
    headers = {"apikey": SERVICE_KEY, "Accept": "application/json"}
    if not SERVICE_KEY.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {SERVICE_KEY}"
    return headers


def api(method, path, body=None, prefer=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = api_headers()
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    request = Request(f"{SUPABASE_URL}/rest/v1/{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            payload = response.read()
            return json.loads(payload.decode("utf-8")) if payload else None
    except (HTTPError, URLError) as exc:
        detail = exc.read(1500).decode("utf-8", "replace") if isinstance(exc, HTTPError) else str(exc)
        raise RuntimeError(f"Supabase API fehlgeschlagen: {detail}") from exc


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.suppress = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "iframe", "object"}:
            self.suppress += 1
        elif not self.suppress and tag in {"p", "div", "br", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "iframe", "object"} and self.suppress:
            self.suppress -= 1
        elif not self.suppress and tag in {"p", "div", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.suppress:
            self.parts.append(data)


def html_to_text(source):
    parser = PlainText()
    parser.feed(source or "")
    parser.close()
    return "\n".join(line.strip() for line in "".join(parser.parts).replace("\r", "").split("\n")).strip()


def format_date(value):
    if not value:
        return ""
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(TZ).strftime("%d.%m.%Y")


def format_time_range(booking):
    start = dt.datetime.fromisoformat(booking["starts_at"].replace("Z", "+00:00")).astimezone(TZ)
    end = dt.datetime.fromisoformat(booking["ends_at"].replace("Z", "+00:00")).astimezone(TZ)
    return f"{start:%H:%M}–{end:%H:%M} Uhr"


def resource_names(booking):
    ids = booking.get("resource_ids") or ([booking["resource_id"]] if booking.get("resource_id") else [])
    ids = list(dict.fromkeys(str(value) for value in ids if value))
    if not ids:
        return ""
    query = quote(",".join(ids), safe=",-")
    rows = api("GET", f"resources?select=id,name&id=in.({query})") or []
    names = {str(row["id"]): row["name"] for row in rows}
    return ", ".join(names.get(value, value) for value in ids)


def config_values():
    rows = api("GET", "site_configuration?select=mail_profiles,mail_templates,event_signature_html&singleton=eq.true&limit=1") or []
    config = rows[0] if rows else {}
    profiles = config.get("mail_profiles") or []
    profile = profiles[0] if profiles else {}
    name = str(profile.get("display_name") or FROM_FALLBACK_NAME).strip()[:100]
    reply_to = str(profile.get("reply_to") or FROM_EMAIL).strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", reply_to):
        raise RuntimeError("Die Standard-Antwortadresse im Mailprofil ist ungültig.")
    templates = config.get("mail_templates") or {}
    normalized = {}
    for kind, defaults in DEFAULT_TEMPLATES.items():
        key = f"booking_{kind}"
        value = templates.get(key) or {}
        normalized[kind] = {
            "subject": str(value.get("subject") or defaults["subject"]),
            "body": str(value.get("body") or defaults["body"]),
        }
    signature = html_to_text(config.get("event_signature_html") or "") or DEFAULT_SIGNATURE
    return name, reply_to, normalized, signature


def booking_values(payload, signature):
    booking = payload or {}
    resource = resource_names(booking)
    values = {
        "title": str(booking.get("title") or ""),
        "date": format_date(booking.get("starts_at")),
        "time_range": format_time_range(booking) if booking.get("starts_at") and booking.get("ends_at") else "",
        "resource_names": resource,
        "signature": signature,
        "previous_title": "",
        "previous_date": "",
        "previous_time_range": "",
        "previous_resource_names": "",
        "change_summary": "",
    }
    previous = booking.get("previous") or {}
    if previous:
        values.update({
            "previous_title": str(previous.get("title") or ""),
            "previous_date": format_date(previous.get("starts_at")),
            "previous_time_range": format_time_range(previous) if previous.get("starts_at") and previous.get("ends_at") else "",
            "previous_resource_names": resource_names(previous),
            "change_summary": "Die vorherigen Angaben stehen im Vergleich zur aktuellen Buchung.",
        })
    return values


def render_template(template, values):
    return re.sub(r"\{\{([a-z_]+)\}\}", lambda match: values.get(match.group(1), match.group(0)), template or "")


def build_message(item, config):
    recipient = str(item.get("recipient") or "").strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient):
        raise RuntimeError("Ungültige Empfängeradresse in der Warteschlange.")
    kind = item.get("kind")
    if kind not in DEFAULT_TEMPLATES:
        raise RuntimeError("Unbekannter Nachrichtentyp in der Warteschlange.")
    display_name, reply_to, templates, signature = config
    values = booking_values(item.get("payload") or {}, signature)
    subject = render_template(templates[kind]["subject"], values).strip()
    body = render_template(templates[kind]["body"], values).strip()
    if not subject or "\r" in subject or "\n" in subject:
        raise RuntimeError("Ungültige Betreffzeile in der E-Mail-Vorlage.")
    if not body:
        raise RuntimeError("Die E-Mail-Vorlage enthält keinen Nachrichtentext.")
    message = EmailMessage(policy=email.policy.SMTP)
    message["From"] = formataddr((display_name, FROM_EMAIL))
    message["Reply-To"] = reply_to
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    message.add_alternative(f"<html><body><pre style=\"font-family:Arial,sans-serif;white-space:pre-wrap\">{html.escape(body)}</pre></body></html>", subtype="html")
    return message


def smtp_connect():
    smtp = smtplib.SMTP_SSL("smtp.strato.de", 465, timeout=35, context=ssl.create_default_context())
    smtp.login(SMTP_USER, SMTP_PASSWORD)
    return smtp


def claim_outbox(limit=25):
    return api("POST", "rpc/claim_booking_email_outbox", {"p_limit": limit}) or []


def update_outbox(item_id, status, error=None, next_attempt_at=None):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    patch = {"status": status, "updated_at": now, "error": (error or "")[:1000] or None}
    if status == "sent":
        patch["sent_at"] = now
    if next_attempt_at:
        patch["next_attempt_at"] = next_attempt_at.isoformat()
    api("PATCH", f"booking_email_outbox?id=eq.{quote(str(item_id), safe='-')}", patch, "return=minimal")


def recover_stale_claims():
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=30)).isoformat()
    api("PATCH", f"booking_email_outbox?status=eq.sending&updated_at=lt.{quote(cutoff, safe=':.-')}",
        {"status": "pending", "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "error": "Erneut eingereiht nach unterbrochenem Versand."},
        "return=minimal")


def process():
    queued = api("POST", "rpc/enqueue_due_booking_reminders", {})
    print(f"Fällige Erinnerungen eingereiht: {queued or 0}")
    recover_stale_claims()
    now_filter = quote(dt.datetime.now(dt.timezone.utc).isoformat(), safe=':.-')
    pending = api("GET", f"booking_email_outbox?select=id&status=eq.pending&next_attempt_at=lte.{now_filter}&limit=1") or []
    if not pending:
        print("Keine Buchungs-E-Mails in der Warteschlange.")
        return
    config = config_values()
    smtp = smtp_connect()
    try:
        while True:
            batch = claim_outbox(25)
            if not batch:
                break
            for item in batch:
                try:
                    message = build_message(item, config)
                    refused = smtp.send_message(message)
                    recipient = item["recipient"]
                    if recipient in refused:
                        code, reason = refused[recipient]
                        if isinstance(reason, bytes):
                            reason = reason.decode("utf-8", "replace")
                        raise RuntimeError(f"SMTP hat die Empfängeradresse abgelehnt ({code}): {reason}")
                    update_outbox(item["id"], "sent")
                    print(f"Buchungsnachricht vom SMTP-Server angenommen: {item['id']} ({item['kind']})")
                except Exception as exc:
                    error = str(exc)[:1000]
                    attempt = int(item.get("attempt_count") or 1)
                    if attempt < 5:
                        delay_minutes = min(5 * (2 ** (attempt - 1)), 60)
                        retry_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=delay_minutes)
                        update_outbox(item["id"], "pending", error, retry_at)
                        print(f"Buchungsnachricht fehlgeschlagen; neuer Versuch ab {retry_at.isoformat()}: {item.get('id')}: {error}", file=sys.stderr)
                    else:
                        update_outbox(item["id"], "failed", error)
                        print(f"Buchungsnachricht nach fünf Versuchen endgültig fehlgeschlagen: {item.get('id')}: {error}", file=sys.stderr)
    finally:
        try:
            smtp.quit()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        process()
    except Exception as exc:
        print(f"Versandlauf fehlgeschlagen: {exc}", file=sys.stderr)
        sys.exit(1)
