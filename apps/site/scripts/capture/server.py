"""Scripted OpenAI-compatible endpoint for staging Sem screenshots."""
import json, sys, time, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = os.path.join(os.path.dirname(__file__), '.out', 'requests.jsonl')
SCRIPT = os.path.join(os.path.dirname(__file__), 'script.py')

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        body = json.dumps({"object": "list", "data": [{"id": "sem-demo", "object": "model", "created": 0, "owned_by": "demo"}]}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with open(LOG, 'a') as f: f.write(json.dumps(req) + '\n')
        ns = {'__file__': SCRIPT}
        exec(open(SCRIPT).read(), ns)
        text, calls = ns['respond'](req)
        if not req.get('stream'):
            msg = {"role": "assistant", "content": text}
            if calls: msg["tool_calls"] = [{"id": f"call_{i}", "type": "function", "function": {"name": n, "arguments": json.dumps(a)}} for i, (n, a) in enumerate(calls)]
            body = json.dumps({"id": "x", "object": "chat.completion", "created": 0, "model": "sem-demo", "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if calls else "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        def chunk(delta, finish=None, usage=None):
            d = {"id": "x", "object": "chat.completion.chunk", "created": 0, "model": "sem-demo", "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
            if usage: d["usage"] = usage
            self.wfile.write(f"data: {json.dumps(d)}\n\n".encode()); self.wfile.flush()
        chunk({"role": "assistant", "content": ""})
        for i in range(0, len(text or ''), 6):
            chunk({"content": text[i:i+6]}); time.sleep(0.01)
        for i, (n, a) in enumerate(calls):
            chunk({"tool_calls": [{"index": i, "id": f"call_{int(time.time()*1000)}_{i}", "type": "function", "function": {"name": n, "arguments": json.dumps(a)}}]})
        chunk({}, "tool_calls" if calls else "stop", {"prompt_tokens": 1200, "completion_tokens": 180, "total_tokens": 1380})
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

ThreadingHTTPServer(('127.0.0.1', 9999), H).serve_forever()
