"""Runs the API's clock from an hour before the capture's fixed moment (CAPTURE_NOW), so the server's
"today" matches the browser's fake clock while everything the capture does on the server (a file
processed, a Canvas read) has happened a little before the browser's "now": a job that finished
after it would stay in the status bar. Loaded by putting this folder on PYTHONPATH; see README."""

import os
from datetime import datetime, timedelta

import time_machine

now = datetime.fromisoformat(os.environ.get("CAPTURE_NOW", "2026-10-21T12:40:00Z"))
time_machine.travel(now - timedelta(hours=1), tick=True).start()
