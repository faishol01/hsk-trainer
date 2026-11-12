"""Verify module delivery and the server's restricted public paths."""

import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer

from serve import ViewerHandler


class QuietHandler(ViewerHandler):
    def log_message(self, *args):
        pass


class ViewerServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def fetch(self, path, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            body = response.read()
            return response.status, response.getheader("Content-Type"), body
        finally:
            connection.close()

    def test_html_data_and_assets_are_public(self):
        for path in ["/", "/index.html", "/data/firebase-config.json",
                     "/data/vocabulary.mjs", "/assets/css/viewer.css",
                     "/assets/js/app.mjs", "/assets/js/bootstrap.js",
                     "/assets/vendor/vis-network.min.js"]:
            for method in ["GET", "HEAD"]:
                with self.subTest(path=path, method=method):
                    status, _, body = self.fetch(path, method)
                    self.assertEqual(status, 200)
                    self.assertEqual(bool(body), method == "GET")

    def test_modules_and_styles_have_browser_content_types(self):
        for path, mime in [("/assets/js/app.mjs", "text/javascript"),
                           ("/assets/js/bootstrap.js", "text/javascript"),
                           ("/data/vocabulary.mjs", "text/javascript"),
                           ("/assets/css/viewer.css", "text/css")]:
            with self.subTest(path=path):
                status, content_type, _ = self.fetch(path)
                self.assertEqual(status, 200)
                self.assertEqual(content_type.split(";")[0], mime)

    def test_project_files_and_directory_listings_are_blocked(self):
        for path in ["/README.md", "/serve.py", "/firestore.rules", "/.git/config",
                     "/tests/test_server.py", "/src/generate.py", "/node_modules/",
                     "/assets/", "/assets/js/", "/data/", "/missing.js"]:
            with self.subTest(path=path):
                self.assertEqual(self.fetch(path)[0], 404)

    def test_traversal_is_blocked_in_each_public_directory(self):
        for path in ["/assets/../README.md", "/assets/%2e%2e/README.md",
                     "/assets/%2e%2e%2fREADME.md", "/assets/%5c../README.md",
                     "/data/../README.md", "/assets/js/%00app.mjs"]:
            for method in ["GET", "HEAD"]:
                with self.subTest(path=path, method=method):
                    self.assertEqual(self.fetch(path, method)[0], 404)


if __name__ == "__main__":
    unittest.main()
