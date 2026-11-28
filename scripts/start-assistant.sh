#!/bin/sh
# Start only local inference; downloading a model requires the explicit setup action.
set -eu

action=${1:-start}
case "$action" in
  start|setup|status) ;;
  -h|--help)
    printf 'Usage: %s [start|setup|status]\n  start   reuse/start Ollama; never download a model\n  setup   reuse/start Ollama and explicitly pull the configured model\n  status  check the local service and model without starting or downloading\n' "$0"
    exit 0 ;;
  *) printf 'Unknown action: %s\n' "$action" >&2; exit 1 ;;
esac
[ "$#" -le 1 ] || { printf 'Pass one action only.\n' >&2; exit 1; }

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -x "$repo_dir/backend/.venv/bin/python" ]; then
  python_bin="$repo_dir/backend/.venv/bin/python"
else
  python_bin=$(command -v python3) || { printf 'Python 3 is required.\n' >&2; exit 1; }
fi
model=${ASSISTANT_MODEL:-qwen3:4b-instruct}
case "$model" in -*) printf 'Invalid model name.\n' >&2; exit 1 ;; esac
runtime_dir=${ASSISTANT_RUNTIME_DIR:-"$repo_dir/.runtime/assistant"}
ollama_url=$("$python_bin" - "${ASSISTANT_OLLAMA_URL:-http://127.0.0.1:11434}" <<'PY'
import sys
from urllib.parse import urlsplit
try:
    url = urlsplit(sys.argv[1])
    valid = (url.scheme == 'http' and url.hostname in {'127.0.0.1', 'localhost', '::1'}
             and url.username is None and url.password is None and url.port is not None
             and url.path in {'', '/'} and not url.query and not url.fragment)
    if not valid:
        raise ValueError('expected a loopback HTTP address with an explicit port')
except ValueError as error:
    raise SystemExit(f'Invalid ASSISTANT_OLLAMA_URL: {error}')
print(f'http://{url.netloc}')
PY
)
export ASSISTANT_MODEL="$model" ASSISTANT_OLLAMA_URL="$ollama_url"
export OLLAMA_HOST="$ollama_url" OLLAMA_NO_CLOUD=1

find_cli() {
  ollama_bin=${OLLAMA_BIN:-}
  if [ -z "$ollama_bin" ]; then
    ollama_bin=$(command -v ollama || true)
  fi
  if [ -z "$ollama_bin" ] && [ -x /Applications/Ollama.app/Contents/Resources/ollama ]; then
    ollama_bin=/Applications/Ollama.app/Contents/Resources/ollama
  fi
  if [ -z "$ollama_bin" ] && [ -x "$HOME/Applications/Ollama.app/Contents/Resources/ollama" ]; then
    ollama_bin="$HOME/Applications/Ollama.app/Contents/Resources/ollama"
  fi
  [ -n "$ollama_bin" ] && [ -x "$ollama_bin" ] || {
    printf 'Ollama CLI not found. Install Ollama or set OLLAMA_BIN to its executable.\n' >&2
    exit 1
  }
}

check_runtime() {
  "$python_bin" - "$ollama_url" "$model" "$1" "$runtime_dir/model.json" <<'PY'
import datetime, json, pathlib, sys, urllib.request
url, model, mode, snapshot = sys.argv[1:]
try:
    # Loopback requests must not be forwarded through a configured HTTP proxy.
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def get(path):
        with client.open(url + path, timeout=1 if mode == 'probe' else 5) as response:
            return json.load(response)
    version = get('/api/version')['version']
    if mode == 'probe':
        raise SystemExit(0)
    models = get('/api/tags')['models']
    found = next((item for item in models if item.get('name') == model or item.get('model') == model), None)
    result = {'ready': bool(found), 'ollama_url': url, 'ollama_version': version, 'model': model}
    if found:
        if found.get('remote_host') or found.get('remote_model') or model.endswith('-cloud') or model.endswith(':cloud'):
            raise ValueError('a local model is required; cloud models are not supported')
        digest = found['digest']
        if not isinstance(digest, str) or not digest:
            raise ValueError('the model has no digest')
        result.update(digest=digest, size_bytes=found.get('size'), details=found.get('details', {}))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not found:
        print('Model missing. Download it explicitly with ./scripts/start-assistant.sh setup.', file=sys.stderr)
        raise SystemExit(2)
    if mode == 'record':
        result['recorded_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        target = pathlib.Path(snapshot)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
except (OSError, ValueError, KeyError, TypeError) as error:
    if mode != 'probe':
        print(f'Local assistant unavailable: {error}', file=sys.stderr)
    raise SystemExit(1)
PY
}

if [ "$action" = status ]; then
  check_runtime status
  exit 0
fi

if check_runtime probe; then
  printf 'Using existing Ollama at %s; its existing cloud configuration is unchanged.\n' "$ollama_url" >&2
else
  find_cli
  umask 077
  mkdir -p "$runtime_dir"
  nohup "$ollama_bin" serve >"$runtime_dir/ollama.log" 2>&1 </dev/null &
  daemon_pid=$!
  printf '%s\n' "$daemon_pid" >"$runtime_dir/ollama.pid"
  printf 'Started local Ollama PID %s; log: %s/ollama.log\n' "$daemon_pid" "$runtime_dir" >&2
  attempt=0
  until check_runtime probe; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 15 ] || ! kill -0 "$daemon_pid" 2>/dev/null; then
      printf 'Ollama did not become ready. Check %s/ollama.log\n' "$runtime_dir" >&2
      exit 1
    fi
    sleep 1
  done
fi

if [ "$action" = setup ]; then
  find_cli
  printf 'Explicit setup: downloading/updating %s.\n' "$model" >&2
  "$ollama_bin" pull "$model"
  check_runtime record
  printf 'Model identity saved in %s/model.json\n' "$runtime_dir" >&2
else
  check_runtime status
fi
