"""NOVA AI Studio — local server: static files + same-origin TTS proxy."""
import http.server
import json
import os
import socket
import socketserver
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("NOVA_PORT", "9001"))
START = time.time()

TTS_URL = "https://translate.google.com/translate_tts?ie=UTF-8&q={q}&tl={lang}&client=tw-ob&ttsspeed={rate}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Referer": "https://translate.google.com/",
}

IMG_URL = "https://image.pollinations.ai/prompt/{prompt}?width={w}&height={h}&nologo=true&enhance=false&seed={seed}"
CHAT_URL = "https://text.pollinations.ai/v1/chat/completions"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
    ".mp3": "audio/mpeg", ".webm": "video/webm",
}


def port_open(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/proxy/tts":
            self.handle_tts(parsed)
            return
        if parsed.path == "/proxy/img":
            self.handle_img(parsed)
            return
        if parsed.path == "/health":
            self._send(200, json.dumps({
                "ok": True, "app": "nova-ai-studio", "uptime": round(time.time() - START, 1),
                "tts": "proxied", "img": "proxied", "chat": "proxied",
            }).encode())
            return
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/proxy/chat":
            self.handle_chat(parsed)
            return
        self._send(404, b'{"error":"not found"}')

    def handle_img(self, parsed):
        q = urllib.parse.parse_qs(parsed.query)
        prompt = (q.get("prompt") or [""])[0][:300]
        w = (q.get("w") or ["384"])[0][:4]
        h = (q.get("h") or ["384"])[0][:4]
        seed = str(int((q.get("seed") or ["0"])[0] or 0))[:10]
        if not prompt.strip():
            self._send(400, b'{"error":"prompt required"}')
            return
        for attempt in range(3):
            url = IMG_URL.format(prompt=urllib.parse.quote(prompt), w=w, h=h, seed=seed)
            if attempt:
                url += "&model=turbo"
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=160) as resp:
                    data = resp.read()
                if data and len(data) > 1000:
                    ct = resp.headers.get("Content-Type") or "image/jpeg"
                    self._send(200, data, ct)
                    return
            except Exception:
                time.sleep(0.5 * (attempt + 1))
        self._send(502, json.dumps({"error": "image ai fail - dobara try karein"}).encode())

    def handle_chat(self, parsed):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8"))
        except Exception:
            self._send(400, b'{"error":"bad json"}')
            return
        messages = body.get("messages") or [{"role": "user", "content": "hi"}]
        payload = {"model": body.get("model", "openai"), "messages": messages, "temperature": 0.7}
        try:
            req = urllib.request.Request(CHAT_URL, data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
            out = ""
            try:
                d = json.loads(raw)
                out = ((d.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            except Exception:
                out = raw.decode("utf-8", "replace")
            if out.strip():
                self._send(200, json.dumps({"choices": [{"message": {"content": out.strip()}}]}).encode())
                return
        except Exception:
            pass
        self._send(502, b'{"choices":[{"message":{"content":""}}]}')

    def handle_tts(self, parsed):
        q = urllib.parse.parse_qs(parsed.query)
        text = (q.get("text") or [""])[0][:450]
        lang = (q.get("lang") or ["ur"])[0][:8]
        rate = (q.get("rate") or ["1"])[0][:4]
        if not text.strip():
            self._send(400, b'{"error":"text required"}')
            return
        url = TTS_URL.format(q=urllib.parse.quote(text), lang=urllib.parse.quote(lang),
                             rate=urllib.parse.quote(rate))
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=25) as resp:
                    data = resp.read()
                if data:
                    self._send(200, data, "audio/mpeg")
                    return
            except Exception:
                time.sleep(0.35 * (attempt + 1))
        self._send(502, b'{"error":"tts failed"}', "application/json")


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def pick_port():
    global PORT
    if not port_open(PORT):
        return PORT
    for p in range(PORT + 1, PORT + 40):
        if not port_open(p):
            PORT = p
            return p
    return PORT


def main():
    port = pick_port()
    print(f"NOVA AI Studio: http://localhost:{port}")
    Server(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
