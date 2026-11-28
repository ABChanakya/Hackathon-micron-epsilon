#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$repo_dir/backend"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --disable-pip-version-check --quiet -r requirements.txt
exec .venv/bin/python "$repo_dir/frontend/Handy frontend/serve.py" --with-backend app:app --host 127.0.0.1 --port 8000 "$@"
