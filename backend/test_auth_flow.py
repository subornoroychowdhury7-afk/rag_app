import os
import sys
import unittest

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

    def test_registration_returns_session_directly(self):
        payload = {"email": "newuser@example.com", "password": "Password123!"}
        res = self.client.post("/auth/register", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Must return session directly without OTP
        self.assertIn("token", data)
        self.assertIn("access_token", data)
        self.assertIn("user", data)
        self.assertEqual(data["user"]["email"], "newuser@example.com")
        self.assertNotIn("otp_required", data)
        self.assertNotIn("otp", data)

        # Token must allow accessing protected /auth/me
        me_res = self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {data['token']}"},
        )
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()["user"]["email"], "newuser@example.com")

    def test_registration_duplicate_email_fails(self):
        payload = {"email": "duplicate@example.com", "password": "Password123!"}
        res1 = self.client.post("/auth/register", json=payload)
        self.assertEqual(res1.status_code, 200)

        res2 = self.client.post("/auth/register", json=payload)
        self.assertEqual(res2.status_code, 409)

    def test_password_login_returns_session_directly(self):
        # Register first
        self.client.post(
            "/auth/register",
            json={"email": "pwdlogin@example.com", "password": "SecurePassword1!"},
        )

        # Login with correct password
        res = self.client.post(
            "/auth/login",
            json={"email": "pwdlogin@example.com", "password": "SecurePassword1!"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Must return session directly
        self.assertIn("token", data)
        self.assertIn("access_token", data)
        self.assertIn("user", data)
        self.assertEqual(data["user"]["email"], "pwdlogin@example.com")
        self.assertNotIn("otp_required", data)

        # Validate session on /auth/me
        me_res = self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {data['token']}"},
        )
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()["user"]["email"], "pwdlogin@example.com")

    def test_password_login_invalid_credentials(self):
        # Wrong password for existing user
        self.client.post(
            "/auth/register",
            json={"email": "badpwd@example.com", "password": "SecurePassword1!"},
        )
        bad_res = self.client.post(
            "/auth/login",
            json={"email": "badpwd@example.com", "password": "WrongPassword!"},
        )
        self.assertEqual(bad_res.status_code, 401)

        # Nonexistent user
        nonexistent = self.client.post(
            "/auth/login",
            json={"email": "nonexistent@example.com", "password": "SomePassword1!"},
        )
        self.assertEqual(nonexistent.status_code, 401)

    def test_registration_password_length_validation(self):
        res = self.client.post(
            "/auth/register",
            json={"email": "short@example.com", "password": "short"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("at least 8 characters", res.json()["detail"])

if __name__ == "__main__":
    unittest.main()
