#!/usr/bin/env bash
set -euo pipefail
payload="$(cat || true)"
python3 - "$PWD" "$payload" <<'PY'
import json, sys
root = sys.argv[1]
payload = sys.argv[2]
try:
    data = json.loads(payload) if payload.strip() else {}
except json.JSONDecodeError:
    data = {}
text = json.dumps(data, ensure_ascii=False)
blocked = [".env", "node_modules/", ".next/", "dist/", "build/", "package-lock.json"]
if root.endswith("kody-workspace"):
    blocked.extend(["kody-frontend/", "kody-backend/"])
if root.endswith("kody-backend"):
    blocked.extend(["prisma/schema.prisma", "prisma/migrations/", "package-lock.json"])
if any(item in text for item in blocked):
    print("Hermes safety adapter blocked protected path or generated/dependency surface.", file=sys.stderr)
    sys.exit(2)
PY
