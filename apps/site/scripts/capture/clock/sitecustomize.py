"""Starts the API's clock at the capture's fixed moment (CAPTURE_NOW), so the server's "today"
matches the browser's fake clock. Loaded by putting this folder on PYTHONPATH; see README."""

import os
from datetime import datetime

import time_machine

time_machine.travel(datetime.fromisoformat(os.environ.get("CAPTURE_NOW", "2026-10-21T12:40:00Z")), tick=True).start()
