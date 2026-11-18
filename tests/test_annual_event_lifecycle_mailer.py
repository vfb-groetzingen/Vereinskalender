import importlib.util
import os
import unittest
from pathlib import Path

os.environ.update({
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test_only",
    "STRATO_SMTP_USER": "vfb-app@vfb-groetzingen.de",
    "STRATO_SMTP_PASSWORD": "test-only",
})

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "send_annual_event_lifecycle_emails.py"
spec = importlib.util.spec_from_file_location("annual_event_lifecycle_mailer", SCRIPT)
mailer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mailer)


class AnnualEventLifecycleMailerTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "templates": {
                "confirmation": {"subject": "Bestätigung: {{title}} am {{date}}", "body": "Guten Tag,\n\nEreignis: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}", "enabled": False},
                "changed": {"subject": "Geändert: {{title}} am {{date}}", "body": "Ereignis geändert: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}", "enabled": False},
                "cancelled": {"subject": "Absage: {{title}}", "body": "Abgesagt: {{title}}\nDatum: {{date}}", "enabled": False},
            },
            "profiles": [],
            "display_name": "VfB Grötzingen",
            "reply_to": "vorstand@example.org",
            "signature_html": "<p>Mit freundlichen Grüßen<br>VfB Grötzingen</p>",
            "signature_text": "Mit freundlichen Grüßen\nVfB Grötzingen",
        }

    def test_event_template_ignores_global_booking_enabled_switch(self):
        item = {
            "kind": "confirmation", "recipient": "person@example.org",
            "payload": {"title": "Sommerfest", "recurrence": "annual", "event_month": 6, "event_day": 10,
                        "append_signature": True, "body_html": "<p>Beginn um 18 Uhr.</p>",
                        "reply_to_email": "veranstaltung@example.org"},
        }
        message = mailer.build_message(item, self.config)
        self.assertEqual(message["Subject"], "Bestätigung: Sommerfest am 10.06.")
        self.assertEqual(message["Reply-To"], "veranstaltung@example.org")
        plain = message.get_body(preferencelist=("plain",)).get_content()
        self.assertIn("Beginn um 18 Uhr", plain)
        self.assertIn("Mit freundlichen Grüßen", plain)
        self.assertNotIn("Zeit:", plain)
        self.assertNotIn("Ort:", plain)

    def test_one_time_date_and_custom_html_are_safely_rendered(self):
        item = {
            "kind": "changed", "recipient": "person@example.org",
            "payload": {"title": "Sommerfest", "recurrence": "once", "event_date": "2027-06-10",
                        "body_html": '<p>Bitte beachten.</p><script>alert(1)</script><img src="cid:missing">'},
        }
        message = mailer.build_message(item, self.config)
        self.assertEqual(message["Subject"], "Geändert: Sommerfest am 10.06.2027")
        html_body = message.get_body(preferencelist=("html",)).get_content()
        self.assertIn("Bitte beachten.", html_body)
        self.assertNotIn("alert(1)", html_body)
        self.assertNotIn("cid:missing", html_body)

    def test_change_template_receives_previous_event_title_and_date(self):
        config = {**self.config, "templates": {**self.config["templates"],
                  "changed": {"subject": "Geändert: {{title}}", "body": "Aktuell {{date}}; vorher {{previous_title}} am {{previous_date}}. {{change_summary}}"}}}
        item = {"kind": "changed", "recipient": "person@example.org", "payload": {
            "title": "Neues Sommerfest", "recurrence": "once", "event_date": "2027-06-10",
            "previous": {"title": "Altes Sommerfest", "recurrence": "once", "event_date": "2027-06-09"},
        }}
        message = mailer.build_message(item, config)
        body = message.get_body(preferencelist=("plain",)).get_content()
        self.assertIn("Aktuell 10.06.2027", body)
        self.assertIn("vorher Altes Sommerfest am 09.06.2027", body)
        self.assertIn("zum Vergleich", body)

    def test_signature_is_optional(self):
        item = {"kind": "confirmation", "recipient": "person@example.org",
                "payload": {"title": "Ereignis", "append_signature": False}}
        message = mailer.build_message(item, self.config)
        self.assertNotIn("Mit freundlichen Grüßen", message.get_body(preferencelist=("plain",)).get_content())

    def test_per_event_switch_and_current_version_are_checked_at_send_time(self):
        item = {"kind": "changed", "payload": {"_expected_updated_at": "2026-05-01T10:00:00+00:00"}}
        current = {"active": True, "changed_enabled": True, "updated_at": "2026-05-01T10:00:00+00:00"}
        self.assertEqual(mailer.template_is_enabled_for_event(item, current), (True, None))
        self.assertFalse(mailer.template_is_enabled_for_event(item, {**current, "changed_enabled": False})[0])
        self.assertFalse(mailer.template_is_enabled_for_event(item, {**current, "updated_at": "2026-05-01T10:01:00+00:00"})[0])
        self.assertFalse(mailer.template_is_enabled_for_event(item, {**current, "active": False})[0])

    def test_deleted_event_cancellation_uses_durable_snapshot(self):
        item = {"kind": "cancelled", "payload": {"title": "Sommerfest", "cancelled_enabled": True}}
        self.assertEqual(mailer.template_is_enabled_for_event(item, None), (True, None))
        self.assertFalse(mailer.template_is_enabled_for_event({**item, "kind": "changed"}, None)[0])
        self.assertFalse(mailer.template_is_enabled_for_event(item, {"active": True, "cancelled_enabled": True})[0])

    def test_worker_marks_disabled_event_message_skipped_without_sending(self):
        item = {"id": 3, "event_id": "event-1", "kind": "confirmation", "recipient": "person@example.org",
                "payload": {"title": "Sommerfest"}, "attempt_count": 1}
        original = {name: getattr(mailer, name) for name in ("api", "config_values", "smtp_connect", "claim_outbox", "recover_stale_claims", "current_event")}
        status_updates = []
        claims = [[item], []]

        class FakeSMTP:
            def send_message(self, _message):
                raise AssertionError("Deaktivierte Ereignis-Mail darf nicht versendet werden")
            def quit(self):
                pass

        def fake_api(method, path, body=None, prefer=None):
            if method == "GET" and path.startswith("annual_event_mail_outbox?select=id"):
                return [{"id": 3}]
            if method == "PATCH" and path.startswith("annual_event_mail_outbox?id=eq."):
                status_updates.append(body)
            return []

        try:
            mailer.api = fake_api
            mailer.config_values = lambda: self.config
            mailer.smtp_connect = lambda: FakeSMTP()
            mailer.claim_outbox = lambda _limit=25: claims.pop(0)
            mailer.recover_stale_claims = lambda: None
            mailer.current_event = lambda _event_id: {"active": True, "confirmation_enabled": False, "updated_at": "2026-05-01T10:00:00+00:00"}
            mailer.process()
        finally:
            for name, value in original.items():
                setattr(mailer, name, value)

        self.assertEqual(len(status_updates), 1)
        self.assertEqual(status_updates[0]["status"], "skipped")
        self.assertIn("deaktiviert", status_updates[0]["error"])

    def test_subject_newlines_are_rejected(self):
        config = {**self.config, "templates": {**self.config["templates"],
                  "confirmation": {"subject": "{{title}}", "body": "Text"}}}
        item = {"kind": "confirmation", "recipient": "person@example.org", "payload": {"title": "Gut\nBöse"}}
        with self.assertRaisesRegex(RuntimeError, "Betreffzeile"):
            mailer.build_message(item, config)


if __name__ == "__main__":
    unittest.main(verbosity=2)
