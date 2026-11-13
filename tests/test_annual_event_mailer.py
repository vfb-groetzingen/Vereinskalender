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
        event = {"recurrence": "once", "event_date": "2026-06-10"}
        self.assertTrue(mailer.event_occurs_on(event, dt.date(2026, 6, 10)))
        self.assertFalse(mailer.event_occurs_on(event, dt.date(2027, 6, 10)))

    def test_annual_event_matches_month_and_day_in_any_year(self):
        event = {"recurrence": "annual", "event_month": 6, "event_day": 10}
        self.assertTrue(mailer.event_occurs_on(event, dt.date(2026, 6, 10)))
        self.assertTrue(mailer.event_occurs_on(event, dt.date(2027, 6, 10)))
        self.assertFalse(mailer.event_occurs_on(event, dt.date(2027, 6, 11)))

    def test_february_29_only_matches_leap_day(self):
        event = {"recurrence": "annual", "event_month": 2, "event_day": 29}
        self.assertTrue(mailer.event_occurs_on(event, dt.date(2028, 2, 29)))
        self.assertFalse(mailer.event_occurs_on(event, dt.date(2028, 2, 28)))

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

    def test_smtp_recipient_rejection_is_reported(self):
        class RejectedSMTP:
            def send_message(self, _message):
                return {"bad@example.org": (550, b"No such user")}

        with self.assertRaisesRegex(RuntimeError, "550.*No such user"):
            mailer.send_checked(RejectedSMTP(), object(), "bad@example.org")

    def test_retention_cutoff_is_three_calendar_years(self):
        self.assertEqual(cleanup.cutoff_date(dt.date(2026, 11, 11)), dt.date(2023, 11, 11))
        self.assertEqual(cleanup.cutoff_date(dt.date(2028, 2, 29)), dt.date(2025, 2, 28))

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
