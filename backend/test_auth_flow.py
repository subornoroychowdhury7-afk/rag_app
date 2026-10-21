import os
import sys
import unittest
from unittest.mock import patch, MagicMock

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_auth.db"))
os.environ["AUTH_DB_PATH"] = TEST_DB_PATH
os.environ["JWT_SECRET"] = "test-secret-key-12345678901234567890"

import auth
auth.AUTH_DB_PATH = TEST_DB_PATH

from fastapi.testclient import TestClient
from main import app

class AuthFlowTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        auth.init_db()

    @classmethod
    def tearDownClass(cls):
        if os.path.exists(TEST_DB_PATH):
            try:
                os.remove(TEST_DB_PATH)
            except Exception:
                pass

    def setUp(self):
        self.client = TestClient(app)
        auth.init_db()

    @patch("auth.send_otp_email")
    def test_registration_requires_otp_and_no_token_leaked(self, mock_send):
        mock_send.return_value = (True, None)

        payload = {"email": "testuser@example.com", "password": "Password123!"}
        res = self.client.post("/auth/register", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Must require OTP
        self.assertTrue(data.get("otp_required"))
        # Must NOT return session token
        self.assertNotIn("token", data)
        self.assertNotIn("access_token", data)
        # Must NOT leak OTP
        self.assertNotIn("otp", data)
        self.assertNotIn("demo_otp", data)
        self.assertNotIn("is_sandbox", data)
        self.assertIn("Verification code sent", data.get("message", ""))

        # Verify send_otp_email was called with a 6-digit string
        self.assertTrue(mock_send.called)
        sent_email, sent_code = mock_send.call_args[0]
        self.assertEqual(sent_email, "testuser@example.com")
        self.assertEqual(len(sent_code), 6)
        self.assertTrue(sent_code.isdigit())

    @patch("time.time")
    @patch("auth.send_otp_email")
    def test_password_login_requires_otp(self, mock_send, mock_time):
        mock_send.return_value = (True, None)
        base_time = 100000.0
        mock_time.return_value = base_time

        # Register first (issues OTP at t=100000)
        self.client.post("/auth/register", json={"email": "pwduser@example.com", "password": "SecurePassword1!"})

        # Try wrong password
        bad_res = self.client.post("/auth/login", json={"email": "pwduser@example.com", "password": "WrongPassword!"})
        self.assertEqual(bad_res.status_code, 401)

        # Advance time beyond the 30-second cooldown
        mock_time.return_value = base_time + 35.0
        mock_send.reset_mock()

        # Try correct password
        res = self.client.post("/auth/login", json={"email": "pwduser@example.com", "password": "SecurePassword1!"})
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Must require OTP
        self.assertTrue(data.get("otp_required"))
        self.assertNotIn("token", data)
        self.assertNotIn("demo_otp", data)

        # OTP should be sent
        self.assertTrue(mock_send.called)

    @patch("auth.send_otp_email")
    def test_otp_verify_single_use_and_attempt_limits(self, mock_send):
        mock_send.return_value = (True, None)

        # Send OTP
        res = self.client.post("/auth/otp/send", json={"email": "singleuse@example.com"})
        self.assertEqual(res.status_code, 200)
        sent_email, real_code = mock_send.call_args[0]

        # 1. Invalid attempt
        bad_verify = self.client.post("/auth/otp/verify", json={"email": "singleuse@example.com", "otp": "000000"})
        self.assertEqual(bad_verify.status_code, 400)
        self.assertIn("attempts remaining", bad_verify.json()["detail"])

        # 2. Correct attempt establishes session
        good_verify = self.client.post("/auth/otp/verify", json={"email": "singleuse@example.com", "otp": real_code})
        self.assertEqual(good_verify.status_code, 200)
        data = good_verify.json()
        self.assertIn("token", data)
        self.assertEqual(data["user"]["email"], "singleuse@example.com")

        # 3. Replay attack: reusing the same code must fail immediately
        replay_verify = self.client.post("/auth/otp/verify", json={"email": "singleuse@example.com", "otp": real_code})
        self.assertEqual(replay_verify.status_code, 400)
        self.assertIn("No verification code requested", replay_verify.json()["detail"])

    @patch("auth.send_otp_email")
    def test_failed_email_delivery_returns_clear_error_no_sandbox(self, mock_send):
        # Email provider returns failure (e.g. Resend 403 unverified domain)
        mock_send.return_value = (False, "Resend API error (403): The domain is not verified at resend.com/domains")

        res = self.client.post("/auth/otp/send", json={"email": "fail@example.com"})
        self.assertEqual(res.status_code, 502)
        detail = res.json().get("detail", "")
        self.assertEqual(detail, auth.USER_DELIVERY_ERROR_MESSAGE)
        self.assertNotIn("Resend", detail)
        self.assertNotIn("resend.com", detail)
        # Verify no fake sandbox mode or demo OTP
        self.assertNotIn("demo_otp", res.json())
        self.assertNotIn("is_sandbox", res.json())

if __name__ == "__main__":
    unittest.main()
