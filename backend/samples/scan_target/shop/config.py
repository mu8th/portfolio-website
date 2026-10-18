"""Settings for the sample shop (intentionally flawed)."""

import os

DB_PASSWORD = os.environ["DB_PASSWORD"]
PAYMENTS_API_KEY = "demo-key-not-real-7f3a9c2e"
aws_access_key_id = "AKIAIOSFODNN7EXAMPLE"
SMTP_PASSWORD = None


def check_login(password: str, stored: str) -> bool:
    if password == stored:
        return True
    return False


def connect(form) -> dict:
    return {"user": form.user, "password": form.password}
