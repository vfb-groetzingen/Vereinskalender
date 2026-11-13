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

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "send_booking_notifications.py"
spec = importlib.util.spec_from_file_location("booking_notification_mailer", SCRIPT)
mailer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mailer)


class BookingNotificationMailerTests(unittest.TestCase):
    def setUp(self):
        self.original_api = mailer.api
        mailer.api = lambda method, path, body=None, prefer=None: [{"id": "room-1", "name": "Besprechungsraum"}]

    def tearDown(self):
        mailer.api = self.original_api

    def test_fixed_strato_sender_and_configured_reply_to(self):
        config = (
            "VfB Grötzingen",
            "vorstand@example.org",
            mailer.DEFAULT_TEMPLATES,
            "Mit freundlichen Grüßen\nVfB Grötzingen",
        )
        item = {
            "kind": "confirmation",
            "recipient": "person@example.org",
            "payload": {
                "title": "Sommerfest",
                "starts_at": "2027-06-10T12:00:00Z",
                "ends_at": "2027-06-10T16:00:00Z",
                "resource_id": "room-1",
            },
        }
        message = mailer.build_message(item, config)
        self.assertIn("vfb-app@vfb-groetzingen.de", message["From"])
        self.assertEqual(message["Reply-To"], "vorstand@example.org")
        self.assertIn("Sommerfest", message.get_body(preferencelist=("plain",)).get_content())
        self.assertIn("Besprechungsraum", message.get_body(preferencelist=("plain",)).get_content())

    def test_rejects_newline_in_rendered_subject(self):
        templates = {**mailer.DEFAULT_TEMPLATES, "confirmation": {"subject": "{{title}}", "body": "Text"}}
        config = ("VfB", "vorstand@example.org", templates, "Gruß")
        item = {"kind": "confirmation", "recipient": "person@example.org", "payload": {"title": "Gut\nBöse"}}
        with self.assertRaisesRegex(RuntimeError, "Betreffzeile"):
            mailer.build_message(item, config)

    def test_retry_backoff_caps_at_one_hour(self):
        self.assertEqual(min(5 * (2 ** (1 - 1)), 60), 5)
        self.assertEqual(min(5 * (2 ** (4 - 1)), 60), 40)
        self.assertEqual(min(5 * (2 ** (5 - 1)), 60), 60)

    def test_turns_signature_html_into_plain_text(self):
        self.assertEqual(
            mailer.html_to_text("<p>Mit freundlichen Grüßen<br>VfB Grötzingen</p><p>Internet: http://www.vfb-groetzingen.de/</p>"),
            "Mit freundlichen Grüßen\nVfB Grötzingen\n\nInternet: http://www.vfb-groetzingen.de/",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
