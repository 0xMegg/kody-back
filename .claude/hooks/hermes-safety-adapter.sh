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
tool_name = data.get("tool_name") or data.get("toolName") or ""
tool_input = data.get("tool_input") or data.get("toolInput") or {}
command = tool_input.get("command") or tool_input.get("cmd") or ""

protected_paths = [
    ".env",
    "node_modules/",
    ".next/",
    "dist/",
    "build/",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
]
if root.endswith("kody-workspace"):
    protected_paths.extend(["kody-frontend/", "kody-backend/"])
if root.endswith("kody-backend"):
    protected_paths.extend(["prisma/schema.prisma", "prisma/migrations/"])

write_tools = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
if tool_name in write_tools or ("file_path" in tool_input and not command):
    candidate_paths = [
        str(tool_input.get("file_path") or ""),
        str(tool_input.get("path") or ""),
        str(tool_input.get("notebook_path") or ""),
    ]
    joined_paths = " ".join(candidate_paths)
    if any(item in joined_paths for item in protected_paths):
        print("Hermes safety adapter blocked edit to protected path or generated/dependency surface.", file=sys.stderr)
        sys.exit(2)

if tool_name == "Bash" or command:
    dangerous_fragments = [
        " rm -rf ",
        " git reset --hard",
        " git clean -fd",
        " git push --force",
        " git push -f",
        " migrate dev",
        " migrate deploy",
        " migrate resolve",
        " db push",
        " create database",
        " drop database",
        " drop schema",
        " drop table",
        " truncate ",
        " alter table",
        " alter role",
        " create role",
        " drop role",
        " grant ",
        " revoke ",
        " insert into ",
        " update ",
        " delete from ",
    ]
    normalized = f" {command.lower()} "
    if any(fragment in normalized for fragment in dangerous_fragments):
        print("Hermes safety adapter blocked destructive or database-mutating command.", file=sys.stderr)
        sys.exit(2)
PY
