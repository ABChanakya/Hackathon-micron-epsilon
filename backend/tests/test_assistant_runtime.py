"""Runtime helper tests use fake CLI/model files and ephemeral loopback servers."""
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import textwrap
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / 'scripts/start-assistant.sh'
MODEL = {'name': 'qwen3:4b-instruct', 'digest': 'f' * 64, 'size': 2500000000,
         'details': {'quantization_level': 'Q4_K_M'}}


@unittest.skipUnless(os.name == 'posix' and shutil.which('sh') and shutil.which('python3'),
                     'requires a POSIX shell and Python 3')
class AssistantRuntimeTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='ollama-runtime-test-')
        self.addCleanup(temporary.cleanup)
        self.temp = Path(temporary.name)
        self.models_file = self.temp / 'models.json'
        self.models_file.write_text(json.dumps({'models': [MODEL]}))
        self.calls_file = self.temp / 'calls.jsonl'
        fake_cli = self.temp / 'ollama'
        fake_cli.write_text(textwrap.dedent('''\
            #!/usr/bin/env python3
            import json, os, sys
            from http.server import BaseHTTPRequestHandler, HTTPServer
            from pathlib import Path
            from urllib.parse import urlsplit
            models = Path(os.environ['TEST_MODELS'])
            with open(os.environ['TEST_CALLS'], 'a') as calls:
                calls.write(json.dumps({'args':sys.argv[1:], 'no_cloud':os.environ.get('OLLAMA_NO_CLOUD'),
                                        'host':os.environ.get('OLLAMA_HOST')}) + '\\n')
            if sys.argv[1] == 'pull':
                models.write_text(os.environ['TEST_MODEL_JSON'])
            elif sys.argv[1] == 'serve':
                class Handler(BaseHTTPRequestHandler):
                    def do_GET(self):
                        content = {'version':'test-runtime'} if self.path == '/api/version' else json.loads(models.read_text())
                        body = json.dumps(content).encode()
                        self.send_response(200); self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
                    def log_message(self, *args): pass
                url=urlsplit(os.environ['OLLAMA_HOST'])
                HTTPServer((url.hostname,url.port),Handler).serve_forever()
            else: raise SystemExit(1)
            '''))
        fake_cli.chmod(0o755)
        models_file = self.models_file

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                content = {'version': 'test-runtime'} if self.path == '/api/version' else json.loads(models_file.read_text())
                body = json.dumps(content).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        self.env = {**os.environ, 'ASSISTANT_OLLAMA_URL': f'http://127.0.0.1:{server.server_port}',
                    'ASSISTANT_MODEL': MODEL['name'], 'OLLAMA_BIN': str(fake_cli),
                    'ASSISTANT_RUNTIME_DIR': str(self.temp / 'runtime'),
                    'TEST_MODELS': str(self.models_file), 'TEST_CALLS': str(self.calls_file),
                    'TEST_MODEL_JSON': json.dumps({'models': [MODEL]})}
        self.addCleanup(self.stop_owned_daemon)

    def stop_owned_daemon(self):
        pid_path = self.temp / 'runtime/ollama.pid'
        if pid_path.exists():
            try:
                os.kill(int(pid_path.read_text()), signal.SIGTERM)
            except ProcessLookupError:
                pass

    def invoke(self, action, code=0, **overrides):
        result = subprocess.run([str(SCRIPT), action], cwd=REPO, env={**self.env, **overrides},
                                capture_output=True, text=True, timeout=40)
        self.assertEqual(result.returncode, code, (result.stdout, result.stderr))
        return result

    def calls(self):
        return [json.loads(line) for line in self.calls_file.read_text().splitlines()] if self.calls_file.exists() else []

    def test_posix_shell_syntax(self):
        result = subprocess.run(['sh', '-n', str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_help_does_not_start_or_download(self):
        self.assertIn('Usage:', self.invoke('--help').stdout)
        self.assertEqual(self.calls(), [])

    def test_missing_model_status_is_explicit_and_read_only(self):
        self.models_file.write_text(json.dumps({'models': []}))
        self.assertFalse(json.loads(self.invoke('status', 2).stdout)['ready'])
        self.assertEqual(self.calls(), [])
        self.assertFalse((self.temp / 'runtime').exists())

    def test_normal_start_never_pulls_a_missing_model(self):
        self.models_file.write_text(json.dumps({'models': []}))
        self.invoke('start', 2)
        self.assertEqual(self.calls(), [])

    def test_ready_status_includes_exact_digest_without_cli(self):
        status = json.loads(self.invoke('status').stdout)
        self.assertEqual(status['digest'], MODEL['digest'])
        self.assertEqual(status['ollama_version'], 'test-runtime')
        self.assertEqual(self.calls(), [])

    def test_normal_start_does_not_replace_existing_service(self):
        self.invoke('start')
        self.assertEqual(self.calls(), [])
        self.assertFalse((self.temp / 'runtime/ollama.pid').exists())

    def test_explicit_setup_pulls_once_and_records_identity(self):
        self.models_file.write_text(json.dumps({'models': []}))
        self.invoke('setup')
        self.assertEqual(self.calls(), [{'args': ['pull', MODEL['name']], 'no_cloud': '1',
                                         'host': self.env['ASSISTANT_OLLAMA_URL']}])
        snapshot = json.loads((self.temp / 'runtime/model.json').read_text())
        self.assertEqual(snapshot['digest'], MODEL['digest'])
        self.assertTrue(snapshot['recorded_at'])

    def test_non_loopback_and_credential_urls_are_rejected(self):
        for url in ['http://example.com:11434', 'http://127.0.0.1:11434@example.com:11434']:
            with self.subTest(url=url):
                self.invoke('status', 1, ASSISTANT_OLLAMA_URL=url)
        self.assertEqual(self.calls(), [])

    def test_unreachable_status_never_starts_a_process(self):
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0))
            self.invoke('status', 1, ASSISTANT_OLLAMA_URL=f'http://127.0.0.1:{reserved.getsockname()[1]}')
        self.assertEqual(self.calls(), [])

    def test_missing_service_starts_owned_loopback_daemon_with_log(self):
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0))
            free_port = reserve.getsockname()[1]
        isolated_url = f'http://127.0.0.1:{free_port}'
        self.invoke('start', ASSISTANT_OLLAMA_URL=isolated_url)
        self.assertEqual(self.calls(), [{'args': ['serve'], 'no_cloud': '1', 'host': isolated_url}])
        self.assertTrue((self.temp / 'runtime/ollama.pid').exists())
        self.assertTrue((self.temp / 'runtime/ollama.log').exists())


if __name__ == '__main__':
    unittest.main()
