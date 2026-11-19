#!/usr/bin/env python3
"""Send lifecycle and individual messages from the durable annual-event outbox."""
import datetime as dt
import email.policy
import html
import importlib.util
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
from pathlib import Path

FROM_EMAIL = "vfb-app@vfb-groetzingen.de"
FROM_FALLBACK_NAME = "VfB Grötzingen"
DEFAULT_SIGNATURE = "Mit freundlichen Grüßen\nVfB Grötzingen\n\nInternet: http://www.vfb-groetzingen.de/"
DEFAULT_TEMPLATES = {
    "confirmation": {
        "subject": "Buchungsbestätigung: {{title}}",
        "body": "Guten Tag,\n\nIhre Anmeldung für das Ereignis wurde gespeichert.\n\nEreignis: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}",
    },
    "changed": {
        "subject": "Änderung zum Ereignis: {{title}}",
        "body": "Guten Tag,\n\nDie Angaben zu diesem Ereignis wurden geändert.\n\nEreignis: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}",
    },
    "cancelled": {
        "subject": "Absage: {{title}}",
        "body": "Guten Tag,\n\nDieses Ereignis wurde abgesagt.\n\nEreignis: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}",
    },
}
KIND_FLAGS = {
    "confirmation": "confirmation_enabled",
    "changed": "changed_enabled",
    "cancelled": "cancelled_enabled",
}
ALLOWED_TAGS = {"p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "h2", "h3", "a", "blockquote"}
VOID_TAGS = {"br"}


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
        if self.suppress:
            return
        if tag == "img":
            alt = dict(attrs).get("alt", "")
            if alt:
                self.parts.append(html.escape(alt))
            return
        if tag not in ALLOWED_TAGS:
            return
        attr_text = ""
        if tag == "a":
            href = dict(attrs).get("href", "")
            if re.match(r"^(https?:|mailto:)", href, re.I):
                attr_text = f' href="{html.escape(href, quote=True)}" rel="noopener noreferrer"'
        self.parts.append(f"<{tag}{attr_text}>")
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in {"script", "style", "iframe", "object"} and self.suppress:
            self.suppress -= 1
            return
        if self.suppress or tag not in self.stack:
            return
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

    def handle_starttag(self, tag, _attrs):
        if tag in {"p", "br", "li", "h2", "h3", "blockquote"}:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def html_to_text(source):
    parser = PlainText()
    parser.feed(source or "")
    parser.close()
    return "\n".join(line.strip() for line in "".join(parser.parts).replace("\r", "").split("\n")).strip()


def format_event_date(payload):
    recurrence = payload.get("recurrence") or "annual"
    try:
        if recurrence == "once" and payload.get("event_date"):
            start = dt.date.fromisoformat(str(payload["event_date"])[:10])
            end = dt.date.fromisoformat(str(payload.get("event_end_date") or payload["event_date"])[:10])
            start_text = start.strftime("%d.%m.%Y")
            return start_text if end == start else f"{start_text}–{end.strftime('%d.%m.%Y')}"
        start = f"{int(payload['event_day']):02d}.{int(payload['event_month']):02d}."
        end_day = int(payload.get("event_end_day") or payload['event_day'])
        end_month = int(payload.get("event_end_month") or payload['event_month'])
        end = f"{end_day:02d}.{end_month:02d}."
        return start if end == start else f"{start}–{end}"
    except (KeyError, TypeError, ValueError):
        return ""


def config_values():
    rows = api("GET", "site_configuration?select=mail_profiles,mail_templates,event_signature_html&singleton=eq.true&limit=1") or []
    config = rows[0] if rows else {}
    templates = config.get("mail_templates") or {}
    normalized = {}
    for kind, defaults in DEFAULT_TEMPLATES.items():
        value = templates.get(f"booking_{kind}") or {}
        normalized[kind] = {
            "subject": str(value.get("subject") or defaults["subject"]),
            "body": str(value.get("body") or defaults["body"]),
        }
    profiles = config.get("mail_profiles") or []
    profile = profiles[0] if profiles else {}
    signature_html = sanitize_html(config.get("event_signature_html") or "")
    signature_text = html_to_text(signature_html) or DEFAULT_SIGNATURE
    return {
        "templates": normalized,
        "profiles": profiles,
        "display_name": str(profile.get("display_name") or FROM_FALLBACK_NAME).strip()[:100],
        "reply_to": str(profile.get("reply_to") or FROM_EMAIL).strip(),
        "signature_html": signature_html,
        "signature_text": signature_text,
    }


def render_template(source, values):
    return re.sub(r"\{\{\s*([a-z_]+)\s*\}\}", lambda match: values.get(match.group(1), ""), source or "")


def text_to_html(source):
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n", source or "") if paragraph.strip()]
    return "".join(f"<p>{'<br>'.join(html.escape(line) for line in paragraph.splitlines())}</p>" for paragraph in paragraphs)


_ANNUAL_MAILER = None


def annual_mailer_module():
    global _ANNUAL_MAILER
    if _ANNUAL_MAILER is None:
        script = Path(__file__).with_name("send_annual_event_emails.py")
        spec = importlib.util.spec_from_file_location("annual_event_attachment_mailer", script)
        if spec is None or spec.loader is None:
            raise RuntimeError("Der Ereignis-Mailer für Anhänge konnte nicht geladen werden.")
        _ANNUAL_MAILER = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_ANNUAL_MAILER)
    return _ANNUAL_MAILER


def build_individual_message(item):
    payload = item.get("payload") or {}
    recipient = str(item.get("recipient") or "").strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient):
        raise RuntimeError("Ungültige Empfängeradresse in der Warteschlange.")
    event = dict(payload)
    event["id"] = str(item.get("event_id") or payload.get("id") or "")
    mailer = annual_mailer_module()
    documents = mailer.load_event_documents(event)
    signature = mailer.event_signature_html() if payload.get("append_signature") is True else None
    return mailer.build_message(event, recipient, documents, signature)


def build_message(item, config):
    kind = item.get("kind")
    if kind == "individual":
        return build_individual_message(item)
    if kind not in KIND_FLAGS:
        raise RuntimeError("Unbekannter Ereignis-Mailtyp in der Warteschlange.")
    recipient = str(item.get("recipient") or "").strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient):
        raise RuntimeError("Ungültige Empfängeradresse in der Warteschlange.")
    payload = item.get("payload") or {}
    template = config["templates"][kind]
    use_signature = payload.get("append_signature") is True
    previous = payload.get("previous") or {}
    values = {
        "title": str(payload.get("title") or payload.get("event_title") or ""),
        "date": format_event_date(payload),
        "time_range": "",
        "resource_names": "",
        "previous_title": str(previous.get("title") or ""),
        "previous_date": format_event_date(previous),
        "previous_time_range": "",
        "previous_resource_names": "",
        "change_summary": "Der vorherige Stand dient zum Vergleich mit den aktuellen Angaben." if previous else "",
        "signature": "",
    }
    subject = render_template(template["subject"], values).strip()
    if not subject or "\r" in subject or "\n" in subject:
        raise RuntimeError("Ungültige Betreffzeile in der Ereignis-Mailvorlage.")
    template_body = template["body"] or ""
    template_body = re.sub(r"\{\{\s*signature\s*\}\}", "", template_body)
    rendered_body = render_template(template_body, values)
    rendered_body = re.sub(r"^\s*(?:Zeit|Ort):\s*$", "", rendered_body, flags=re.I | re.M)
    rendered_body = re.sub(r"\n{3,}", "\n\n", rendered_body).strip()
    if not rendered_body:
        raise RuntimeError("Die Ereignis-Mailvorlage enthält keinen Nachrichtentext.")

    body_html = text_to_html(rendered_body)
    event_body = sanitize_html(payload.get("body_html") or "")
    if event_body:
        body_html += event_body
    if use_signature:
        signature_html = config["signature_html"] or text_to_html(config["signature_text"])
        if signature_html:
            body_html += signature_html

    display_name = str(payload.get("sender_display_name") or config["display_name"] or FROM_FALLBACK_NAME).strip()[:100]
    reply_to = str(payload.get("reply_to_email") or config["reply_to"] or FROM_EMAIL).strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", reply_to):
        raise RuntimeError("Ungültige Antwortadresse im Ereignis-Mailprofil.")
    message = EmailMessage(policy=email.policy.SMTP)
    message["From"] = formataddr((display_name, FROM_EMAIL))
    message["Reply-To"] = reply_to
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(html_to_text(body_html) or "Diese Nachricht enthält eine formatierte E-Mail.")
    message.add_alternative(f"<html><body>{body_html}</body></html>", subtype="html")
    return message


def template_is_enabled_for_event(item, current_event):
    kind = item.get("kind")
    if kind != "individual" and kind not in KIND_FLAGS:
        return False, "Unbekannter Ereignis-Mailtyp."
    if current_event is None:
        if kind == "cancelled":
            return True, None
        return False, "Ereignis wurde gelöscht; Nachricht übersprungen."
    if kind == "cancelled" and current_event.get("active") is True:
        return False, "Ereignis ist wieder aktiv; alte Absage übersprungen."
    if kind != "cancelled" and current_event.get("active") is not True:
        return False, "Ereignis ist pausiert; Nachricht übersprungen."
    if kind in KIND_FLAGS and current_event.get(KIND_FLAGS[kind]) is not True:
        return False, "Dieser Ereignis-Mailtyp ist inzwischen deaktiviert."
    expected = (item.get("payload") or {}).get("_expected_updated_at")
    actual = current_event.get("updated_at")
    if expected and actual:
        try:
            expected_dt = dt.datetime.fromisoformat(str(expected).replace("Z", "+00:00"))
            actual_dt = dt.datetime.fromisoformat(str(actual).replace("Z", "+00:00"))
            if expected_dt != actual_dt:
                return False, "Ereignis wurde seit dem Einreihen geändert; veraltete Nachricht übersprungen."
        except ValueError:
            if str(expected) != str(actual):
                return False, "Ereignisstand konnte nicht bestätigt werden; Nachricht übersprungen."
    return True, None


def current_event(event_id):
    query = (
        "annual_email_events?select=id,active,confirmation_enabled,changed_enabled,cancelled_enabled,updated_at"
        f"&id=eq.{quote(str(event_id), safe='-')}&limit=1"
    )
    rows = api("GET", query) or []
    return rows[0] if rows else None


def smtp_connect():
    smtp = smtplib.SMTP_SSL("smtp.strato.de", 465, timeout=35, context=ssl.create_default_context())
    smtp.login(SMTP_USER, SMTP_PASSWORD)
    return smtp


def claim_outbox(limit=25):
    return api("POST", "rpc/claim_annual_event_mail_outbox", {"p_limit": limit}) or []


def update_outbox(item_id, status, error=None, next_attempt_at=None):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    patch = {"status": status, "updated_at": now, "error": (error or "")[:1000] or None}
    if status == "sent":
        patch["sent_at"] = now
    if next_attempt_at:
        patch["next_attempt_at"] = next_attempt_at.isoformat()
    api("PATCH", f"annual_event_mail_outbox?id=eq.{quote(str(item_id), safe='-')}", patch, "return=minimal")


def recover_stale_claims():
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=30)).isoformat()
    api("PATCH", f"annual_event_mail_outbox?status=eq.sending&updated_at=lt.{quote(cutoff, safe=':.-')}",
        {"status": "pending", "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "error": "Erneut eingereiht nach unterbrochenem Versand."},
        "return=minimal")


def process():
    recover_stale_claims()
    now_filter = quote(dt.datetime.now(dt.timezone.utc).isoformat(), safe=":.-")
    pending = api("GET", f"annual_event_mail_outbox?select=id&status=eq.pending&next_attempt_at=lte.{now_filter}&limit=1") or []
    if not pending:
        print("Keine Ereignis-Mails in der Warteschlange.")
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
                    event_id = str(item.get("event_id") or "")
                    allowed, reason = template_is_enabled_for_event(item, current_event(event_id))
                    if not allowed:
                        update_outbox(item["id"], "skipped", reason)
                        print(f"Ereignis-Mail übersprungen: {item.get('id')} ({item.get('kind')})")
                        continue
                    message = build_message(item, config)
                    refused = smtp.send_message(message)
                    recipient = item["recipient"]
                    if recipient in refused:
                        code, response = refused[recipient]
                        if isinstance(response, bytes):
                            response = response.decode("utf-8", "replace")
                        raise RuntimeError(f"SMTP hat die Empfängeradresse abgelehnt ({code}): {response}")
                    update_outbox(item["id"], "sent")
                    print(f"Ereignis-Mail vom SMTP-Server angenommen: {item['id']} ({item['kind']})")
                except Exception as exc:
                    error = str(exc)[:1000]
                    attempt = int(item.get("attempt_count") or 1)
                    if attempt < 5:
                        delay_minutes = min(5 * (2 ** (attempt - 1)), 60)
                        retry_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=delay_minutes)
                        update_outbox(item["id"], "pending", error, retry_at)
                        print(f"Ereignis-Mail fehlgeschlagen; neuer Versuch ab {retry_at.isoformat()}: {item.get('id')}: {error}", file=sys.stderr)
                    else:
                        update_outbox(item["id"], "failed", error)
                        print(f"Ereignis-Mail nach fünf Versuchen endgültig fehlgeschlagen: {item.get('id')}: {error}", file=sys.stderr)
    finally:
        try:
            smtp.quit()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        process()
    except Exception as error:
        print(f"Versandlauf fehlgeschlagen: {error}", file=sys.stderr)
        sys.exit(1)
