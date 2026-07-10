#!/usr/bin/env bash
set -euo pipefail

(cd kg-service && python -m uvicorn main:app --host 127.0.0.1 --port 8001) &

cd chatbot-server
exec python -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-7860}"
