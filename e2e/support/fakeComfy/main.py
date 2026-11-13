import argparse
import errno
import html
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

INSTALL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIND_ATTEMPTS = 40
BIND_RETRY_SECONDS = 0.25


def marker_exists(name):
    return os.path.exists(os.path.join(INSTALL_DIR, name))


def read_marker(name):
    with open(os.path.join(INSTALL_DIR, name), encoding="utf-8") as marker:
        return marker.read()


def build_parser():
    parser = argparse.ArgumentParser(prog="main.py")
    parser.add_argument("--port", type=int, default=8188, help="Set the listen port.")
    parser.add_argument(
        "--listen",
        nargs="?",
        const="0.0.0.0",
        default="127.0.0.1",
        metavar="IP",
        help="Specify the IP address to listen on.",
    )
    parser.add_argument("--enable-manager", action="store_true", help="Enable ComfyUI-Manager.")
    parser.add_argument("--enable-assets", action="store_true", help="Enable the assets subsystem.")
    parser.add_argument(
        "--enable-asset-hashing", action="store_true", help="Hash assets while scanning."
    )
    parser.add_argument("--user-directory", help="Set the ComfyUI user directory.")
    parser.add_argument("--input-directory", help="Set the ComfyUI input directory.")
    parser.add_argument("--output-directory", help="Set the ComfyUI output directory.")
    parser.add_argument(
        "--extra-model-paths-config",
        metavar="PATH",
        action="append",
        help="Load extra model paths from a YAML file.",
    )
    parser.add_argument(
        "--feature-flag",
        metavar="KEY=VALUE",
        action="append",
        help="Set a desktop feature flag.",
    )
    parser.add_argument(
        "--list-feature-flags",
        action="store_true",
        help="List supported feature flags and exit.",
    )
    return parser


def canvas_page(argv):
    launched_with = html.escape(" ".join(argv)) or "no arguments"
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>ComfyUI (e2e stub)</title>
<style>
  html,body{{margin:0;height:100%;background:#16121a;color:#cfc8d6;
    font:14px/1.5 system-ui,sans-serif;display:flex;align-items:center;justify-content:center}}
  .card{{text-align:center;opacity:.75}}
  code{{color:#e3ff3c}}
</style></head><body><div class="card">
  <p>ComfyUI stub &mdash; e2e fixture canvas</p>
  <p>launched with <code>{launched_with}</code></p>
</div></body></html>"""


class ComfyStubHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def respond(self, content_type, body):
        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/queue":
            if marker_exists("queue-hang"):
                threading.Event().wait()
            running = [[0, "e2e-prompt"]] if marker_exists("queue-busy") else []
            self.respond(
                "application/json", json.dumps({"queue_running": running, "queue_pending": []})
            )
            return
        if self.path == "/e2e/stub-process":
            self.respond(
                "application/json", json.dumps({"pid": os.getpid(), "argv": sys.argv[1:]})
            )
            return
        self.respond("text/html; charset=utf-8", canvas_page(sys.argv[1:]))


class ComfyStubServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"


def bind(port):
    attempts_left = BIND_ATTEMPTS
    while True:
        try:
            return ComfyStubServer(("127.0.0.1", port), ComfyStubHandler)
        except OSError as error:
            if error.errno != errno.EADDRINUSE or attempts_left <= 0:
                raise
            attempts_left -= 1
            time.sleep(BIND_RETRY_SECONDS)


def main():
    args = build_parser().parse_args()
    if args.list_feature_flags:
        print(json.dumps({}))
        return
    if marker_exists("startup-failure"):
        sys.stderr.write(read_marker("startup-failure"))
        sys.stderr.flush()
        sys.exit(1)
    server = bind(args.port)
    print("Starting server\n", flush=True)
    print(f"To see the GUI go to: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
