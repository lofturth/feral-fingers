from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class DevelopmentHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


ThreadingHTTPServer(('127.0.0.1', 4177), DevelopmentHandler).serve_forever()
