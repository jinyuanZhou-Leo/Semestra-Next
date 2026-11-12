"""A stand-in Canvas instance for the site's LMS shots: the few REST endpoints Semestra reads, with
Maya's fall courses. Only for capturing screenshots (see README); it accepts any token.

    python3 canvas.py   # http://127.0.0.1:9998
"""

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

BASE = "http://127.0.0.1:9998"
TERM = {"id": 12, "name": "2026 Fall", "start_at": "2026-09-08T04:00:00Z", "end_at": "2026-12-23T05:00:00Z"}
COURSES = [
    (101, "ECE244H1 F LEC0101", "ECE244H1 F: Programming Fundamentals"),
    (102, "MAT290H1 F LEC0102", "MAT290H1 F: Advanced Engineering Mathematics"),
    (103, "ECE216H1 F LEC0101", "ECE216H1 F: Signals and Systems"),
    (104, "ECE231H1 F LEC0101", "ECE231H1 F: Introductory Electronics"),
    (105, "ECE297H1 F LEC0101", "ECE297H1 F: Software Design and Communication"),
]


def course(cid, code, name):
    return {
        "id": cid,
        "course_code": code,
        "name": name,
        "workflow_state": "available",
        "default_view": "modules",
        "apply_assignment_group_weights": True,
        "term": TERM,
        "syllabus_body": "<p>See the course outline for the marking scheme.</p>",
    }


def submission(score=None, submitted=None, graded=None):
    if score is not None:
        return {"workflow_state": "graded", "score": score, "grade": str(score), "submitted_at": submitted, "graded_at": graded, "attempt": 1}
    if submitted:
        return {"workflow_state": "submitted", "submitted_at": submitted, "attempt": 1}
    return {"workflow_state": "unsubmitted"}


def assignment(cid, aid, name, due, points, sub, kinds=("online_upload",), quiz=False):
    return {
        "id": aid,
        "name": name,
        "due_at": due,
        "points_possible": points,
        "html_url": f"{BASE}/courses/{cid}/assignments/{aid}",
        "submission_types": list(kinds),
        "is_quiz_assignment": quiz,
        "published": True,
        "allowed_attempts": -1,
        "description": f"<p>{name}. Submit your work on Canvas before the deadline.</p>",
        "submission": sub,
        "updated_at": "2026-10-20T15:00:00Z",
    }


# ECE244: the gradebook's assessments, plus Lab 7, posted this week and not imported yet.
ECE244 = [
    {"id": 2441, "name": "Labs", "group_weight": 28, "assignments": [
        assignment(101, 24401, "Lab 1", "2026-09-20T03:59:00Z", 10, submission(10, "2026-09-19T20:00:00Z", "2026-09-23T14:00:00Z")),
        assignment(101, 24402, "Lab 2", "2026-09-27T03:59:00Z", 10, submission(9.5, "2026-09-26T21:00:00Z", "2026-09-30T14:00:00Z")),
        assignment(101, 24403, "Lab 3", "2026-10-04T03:59:00Z", 10, submission(9.2, "2026-10-03T22:00:00Z", "2026-10-07T14:00:00Z")),
        assignment(101, 24404, "Lab 4", "2026-10-18T03:59:00Z", 10, submission(8.8, "2026-10-17T23:00:00Z", "2026-10-20T14:00:00Z")),
        assignment(101, 24405, "Lab 5", "2026-11-01T03:59:00Z", 10, submission()),
        assignment(101, 24406, "Lab 6", "2026-11-15T04:59:00Z", 10, submission()),
        assignment(101, 24407, "Lab 7: Hash tables", "2026-11-29T04:59:00Z", 10, submission()),
    ]},
    {"id": 2442, "name": "Quizzes", "group_weight": 10, "assignments": [
        assignment(101, 24411, "Quiz 1", "2026-09-30T13:00:00Z", 20, submission(16.8, "2026-09-30T13:30:00Z", "2026-09-30T14:00:00Z"), ("online_quiz",), True),
        assignment(101, 24412, "Quiz 2", "2026-10-14T13:00:00Z", 20, submission(18, "2026-10-14T13:30:00Z", "2026-10-14T14:00:00Z"), ("online_quiz",), True),
        assignment(101, 24413, "Quiz 3", "2026-11-04T14:00:00Z", 20, submission(), ("online_quiz",), True),
    ]},
    {"id": 2443, "name": "Exams", "group_weight": 62, "assignments": [
        assignment(101, 24421, "Midterm", "2026-10-16T22:00:00Z", 100, submission(78, None, "2026-10-20T14:00:00Z"), ("on_paper",)),
        assignment(101, 24422, "Final exam", "2026-12-14T14:00:00Z", 100, submission(), ("on_paper",)),
    ]},
    {"id": 2444, "name": "Readings", "group_weight": 0, "assignments": [
        assignment(101, 24431, "Read Ch. 9 before lecture", "2026-10-26T13:00:00Z", 0, submission(), ("none",)),
    ]},
]

TABS = [
    {"id": "home", "label": "Home", "type": "internal", "position": 1},
    {"id": "announcements", "label": "Announcements", "type": "internal", "position": 2},
    {"id": "assignments", "label": "Assignments", "type": "internal", "position": 3},
    {"id": "quizzes", "label": "Quizzes", "type": "internal", "position": 4},
    {"id": "grades", "label": "Grades", "type": "internal", "position": 5},
    {"id": "modules", "label": "Modules", "type": "internal", "position": 6},
    {"id": "syllabus", "label": "Syllabus", "type": "internal", "position": 7},
]

ANNOUNCEMENTS = [
    {"id": 9101, "context_code": "course_101", "title": "Lab 7 is posted", "message": "<p>Lab 7 (hash tables) is now on Canvas. Start early: the autotester opens on Monday.</p>", "user_name": "Prof. Lee", "posted_at": "2026-10-20T16:00:00Z", "read_state": "unread", "html_url": f"{BASE}/courses/101/discussion_topics/9101"},
    {"id": 9102, "context_code": "course_103", "title": "Midterm room assignments", "message": "<p>The midterm is on Tuesday, Oct 27 at 6 PM in EX 100. Bring your T-Card.</p>", "user_name": "Prof. Ahmed", "posted_at": "2026-10-19T14:00:00Z", "read_state": "unread", "html_url": f"{BASE}/courses/103/discussion_topics/9102"},
]


def route(path, query):
    path = path.removeprefix("/api/v1")
    if path == "/users/self/profile":
        return {"id": 7, "name": "Maya Chen", "short_name": "Maya"}
    if path == "/courses":
        return [] if query.get("enrollment_state") == ["completed"] else [course(*c) for c in COURSES]
    if m := re.fullmatch(r"/courses/(\d+)", path):
        found = [c for c in COURSES if c[0] == int(m[1])]
        return course(*found[0]) if found else None
    if re.fullmatch(r"/courses/\d+/tabs", path):
        return TABS
    if path == "/announcements":
        codes = query.get("context_codes[]", [])
        return [a for a in ANNOUNCEMENTS if a["context_code"] in codes]
    if m := re.fullmatch(r"/courses/(\d+)/assignment_groups", path):
        return ECE244 if m[1] == "101" else []
    if m := re.fullmatch(r"/courses/(\d+)/enrollments", path):
        score = {"101": 84.6, "102": 84.1, "103": 92.5, "104": 79.8, "105": 94.0}[m[1]]
        return [{"id": int(m[1]) * 10, "grades": {"current_score": score, "current_grade": None}}]
    if re.fullmatch(r"/courses/\d+/(modules|quizzes|pages|discussion_topics|files)", path) or path in (
        "/calendar_events",
        "/planner/items",
    ):
        return []
    if re.fullmatch(r"/courses/\d+/folders/root", path):
        return {"id": 1, "name": "course files", "full_name": "course files", "files_count": 0, "folders_count": 0}
    if re.fullmatch(r"/folders/\d+/(folders|files)", path):
        return []
    return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlsplit(self.path)
        body = route(url.path, parse_qs(url.query))
        if body is None:
            self._send(404, {"errors": [{"message": "The specified resource does not exist."}]})
        else:
            self._send(200, body)

    do_PUT = do_POST = do_GET


ThreadingHTTPServer(("127.0.0.1", 9998), Handler).serve_forever()
