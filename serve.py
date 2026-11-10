"""Serve index.html and data files using only the Python standard library.

Run: python serve.py [--host 127.0.0.1] [--port 8000]
"""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent


class ViewerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        # Decode before checking so encoded traversal cannot bypass the allowlist.
        try:
            path = unquote(urlsplit(self.path).path, errors="strict")
            parts = path.split("/")
            if ".." in parts or "\\" in path or "\x00" in path:
                raise ValueError("Invalid path")

            if path == "/":
                self.path = "/index.html"
                path = "/index.html"

            target = Path(self.translate_path(self.path)).resolve()
            if path == "/index.html":
                allowed = target == ROOT / "index.html"
            elif path.startswith("/data/"):
                allowed = target.is_relative_to(ROOT / "data")
            else:
                allowed = False

            # Resolving first also prevents symlinks escaping the allowed paths.
            if not allowed or not target.is_file():
                self.send_error(404, "File not found")
                return None
        except (ValueError, OSError, RuntimeError):
            self.send_error(404, "File not found")
            return None

        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "File not found")
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    args = parser.parse_args()

    with ThreadingHTTPServer((args.host, args.port), ViewerHandler) as server:
        print(f"Serving the viewer on http://{args.host}:{server.server_port}/")
        print("Press Ctrl+C to stop.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
