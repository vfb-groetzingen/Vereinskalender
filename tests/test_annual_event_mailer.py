import datetime as dt
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

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "send_annual_event_emails.py"
spec = importlib.util.spec_from_file_location("annual_event_mailer", SCRIPT)
mailer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mailer)

CLEANUP_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "cleanup_annual_event_data.py"
cleanup_spec = importlib.util.spec_from_file_location("annual_event_cleanup", CLEANUP_SCRIPT)
cleanup = importlib.util.module_from_spec(cleanup_spec)
cleanup_spec.loader.exec_module(cleanup)


class AnnualEventMailerTests(unittest.TestCase):
    def test_one_time_event_only_matches_its_exact_date(self):
        event = {"recurrence": "once", "event_date": "2026-06-10", "event_end_date": "2026-06-12"}
        self.assertTrue(mailer.event_occurs_on(event, dt.date(2026, 6, 10)))
        self.assertFalse(mailer.event_occurs_on(event, dt.date(2026, 6, 12)))
        self.assertFalse(mailer.event_occurs_on(event, dt.date(2027, 6, 10)))

    def test_annual_event_matches_month_and_day_in_any_year(self):
        event = {"recurrence": "annual", "event_month": 6, "event_day": 10, "event_end_month": 6, "event_end_day": 12}
        self.assertTrue(mailer.event_occurs_on(event, dt.date(2026, 6, 10)))
        self.assertTrue(mailer.event_occurs_on(event, dt.date(2027, 6, 10)))
        self.assertFalse(mailer.event_occurs_on(event, dt.date(2026, 6, 12)))
        self.assertFalse(mailer.event_occurs_on(event, dt.date(2027, 6, 11)))

    def test_february_29_only_matches_leap_day(self):
        event = {"recurrence": "annual", "event_month": 2, "event_day": 29}
        self.assertTrue(mailer.event_occurs_on(event, dt.date(2028, 2, 29)))
        self.assertFalse(mailer.event_occurs_on(event, dt.date(2028, 2, 28)))

    def test_reminder_is_due_only_for_enabled_event_and_selected_lead_time(self):
        today = dt.date(2026, 6, 3)
        event = {"recurrence": "once", "event_date": "2026-06-10", "active": True,
                 "reminder_enabled": True, "reminder_days": 7}
        self.assertTrue(mailer.event_reminder_due_on(event, today))
        event["reminder_days"] = 2
        self.assertFalse(mailer.event_reminder_due_on(event, today))
        event["reminder_enabled"] = False
        self.assertFalse(mailer.event_reminder_due_on(event, today))
        event["reminder_enabled"] = True
        event["active"] = False
        self.assertFalse(mailer.event_reminder_due_on(event, today))

    def test_reminder_due_date_supports_annual_occurrences(self):
        event = {"recurrence": "annual", "event_month": 6, "event_day": 10,
                 "active": True, "reminder_enabled": True, "reminder_days": 2}
        self.assertTrue(mailer.event_reminder_due_on(event, dt.date(2026, 6, 8)))
        self.assertFalse(mailer.event_reminder_due_on(event, dt.date(2026, 6, 9)))

    def test_selected_profile_sets_reply_to_without_changing_authenticated_sender(self):
        event = {
            "id": "event-1",
            "title": "Sommerfest",
            "subject": "Einladung",
            "body_html": "<p>Willkommen</p>",
            "sender_display_name": "VfB Grötzingen",
            "reply_to_email": "vorstand@example.org",
            "assets": [],
        }
        message = mailer.build_message(event, "person@example.org")
        self.assertIn("vfb-app@vfb-groetzingen.de", message["From"])
        self.assertIn("vorstand@example.org", message["Reply-To"])

    def test_annual_reminder_appends_signature_only_when_enabled(self):
        event = {"id": "event-signature", "title": "Sommerfest", "subject": "Erinnerung",
                 "body_html": "<p>Wir freuen uns.</p>", "append_signature": True, "assets": []}
        message = mailer.build_message(event, "person@example.org", signature_html="<p>Viele Grüße<br>VfB</p>")
        self.assertIn("Viele Grüße", message.get_body(preferencelist=("plain",)).get_content())
        self.assertIn("Viele Grüße", message.get_body(preferencelist=("html",)).get_content())
        event["append_signature"] = False
        message = mailer.build_message(event, "person@example.org", signature_html="<p>Viele Grüße</p>")
        self.assertNotIn("Viele Grüße", message.get_body(preferencelist=("plain",)).get_content())

    def test_annual_send_loads_selected_documents_before_building_message(self):
        event = {
            "id": "event-annual-1",
            "title": "Jahrestag",
            "active": True,
            "reminder_enabled": True,
            "subject": "Einladung zum Jahrestag",
            "body_html": "<p>Wir laden ein.</p>",
            "recipients": ["person@example.org"],
            "assets": [],
            "document_ids": ["document-1"],
        }
        documents = [{
            "id": "document-1",
            "file_name": "Programm.pdf",
            "storage_path": "document-1/programm.pdf",
            "mime_type": "application/pdf",
            "file_size": 8,
        }]
        sent_messages = []
        delivery_statuses = []
        original_previous = mailer.previous_delivery_statuses
        original_load_documents = mailer.load_event_documents
        original_download = mailer.download_library_asset
        original_upsert = mailer.upsert_delivery

        class FakeSMTP:
            def send_message(self, message):
                sent_messages.append(message)
                return {}

        try:
            mailer.previous_delivery_statuses = lambda _event_id, _year: []
            mailer.load_event_documents = lambda _event: documents
            mailer.download_library_asset = lambda _path, _document_id: b"pdf-data"
            mailer.upsert_delivery = lambda _event, _date, _recipient, status, *args, **kwargs: delivery_statuses.append(status)
            mailer.send_event_recipients(event, dt.date(2026, 11, 18), FakeSMTP())
        finally:
            mailer.previous_delivery_statuses = original_previous
            mailer.load_event_documents = original_load_documents
            mailer.download_library_asset = original_download
            mailer.upsert_delivery = original_upsert

        self.assertEqual(delivery_statuses, ["sending", "sent"])
        self.assertEqual(len(sent_messages), 1)
        attachments = list(sent_messages[0].iter_attachments())
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0].get_filename(), "Programm.pdf")

    def test_smtp_recipient_rejection_is_reported(self):
        class RejectedSMTP:
            def send_message(self, _message):
                return {"bad@example.org": (550, b"No such user")}

        with self.assertRaisesRegex(RuntimeError, "550.*No such user"):
            mailer.send_checked(RejectedSMTP(), object(), "bad@example.org")

    def test_retention_cutoff_is_three_calendar_years(self):
        self.assertEqual(cleanup.cutoff_date(dt.date(2026, 11, 11)), dt.date(2023, 11, 11))
        self.assertEqual(cleanup.cutoff_date(dt.date(2028, 2, 29)), dt.date(2025, 2, 28))

    def test_one_time_event_retention_waits_until_end_date_is_expired(self):
        cutoff = dt.date(2023, 11, 11)
        event = {"id": "event-1", "event_date": "2020-12-01", "event_end_date": "2024-01-02", "assets": []}
        requests = []
        original = cleanup.request_json
        def fake_request(method, path, body=None, prefer=None):
            requests.append((method, path))
            return [event] if len(requests) == 1 else []
        cleanup.request_json = fake_request
        try:
            self.assertEqual(cleanup.expired_events(cutoff), [event])
        finally:
            cleanup.request_json = original
        self.assertIn("event_end_date=lt.2023-11-11", requests[0][1])
        self.assertIn("select=id,event_date,event_end_date,assets", requests[0][1])

    def test_storage_cleanup_rejects_paths_outside_event_folder(self):
        with self.assertRaisesRegex(RuntimeError, "Ungültiger Dateipfad"):
            cleanup.asset_paths({"id": "event-1", "assets": [{"path": "other-event/file.png"}]})

    def test_annual_delivery_log_keeps_event_and_occurrence_date(self):
        captured = []
        original_api = mailer.api
        try:
            mailer.api = lambda method, path, body=None, prefer=None: captured.append(body)
            mailer.upsert_delivery(
                {"id": "event-1", "title": "Sommerfest", "recurrence": "once"},
                dt.date(2026, 6, 10), "person@example.org", "failed", error="SMTP 550",
            )
        finally:
            mailer.api = original_api
        row = captured[0][0]
        self.assertEqual(row["event_title"], "Sommerfest")
        self.assertEqual(row["recurrence"], "once")
        self.assertEqual(row["event_date"], "2026-06-10")


if __name__ == "__main__":
    unittest.main(verbosity=2)
