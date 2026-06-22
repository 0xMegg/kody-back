#!/usr/bin/env bash
set -euo pipefail
payload="$(cat || true)"
python3 - "$PWD" "$payload" <<'PY'
import fnmatch
import json
import os
import re
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
payload = sys.argv[2]
try:
    data = json.loads(payload) if payload.strip() else {}
except json.JSONDecodeError:
    data = {}

tool_name = data.get("tool_name") or data.get("toolName") or ""
tool_input = data.get("tool_input") or data.get("toolInput") or {}
command = str(tool_input.get("command") or tool_input.get("cmd") or "")


def find_workspace(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / ".hermes").is_dir() and candidate.name == "kody-workspace":
            return candidate
    return start


workspace = find_workspace(root)
gate_path = workspace / ".hermes" / "gates" / "prisma-active-gate.json"
try:
    gate = json.loads(gate_path.read_text()) if gate_path.exists() else {}
except Exception:
    gate = {}

gate_active = bool(gate.get("active"))
allowed_write_paths = [str(p) for p in gate.get("allowedWritePaths") or []]
allowed_commands = [" ".join(str(c).split()) for c in (gate.get("allowedCommands") or [])]
forbidden_entries = [str(f).lower() for f in (gate.get("forbidden") or [])]


def to_workspace_rel(raw: str) -> str:
    if not raw:
        return ""
    raw = os.path.expanduser(raw)
    p = Path(raw)
    if not p.is_absolute():
        p = (root / p).resolve()
    else:
        p = p.resolve()
    try:
        return p.relative_to(workspace).as_posix()
    except ValueError:
        return p.as_posix()


def is_gate_allowed_path(raw: str) -> bool:
    rel = to_workspace_rel(raw)
    if not rel:
        return False
    return any(fnmatch.fnmatchcase(rel, pattern) for pattern in allowed_write_paths)


def normalized_command(cmd: str) -> str:
    return " ".join(cmd.strip().split())


def is_gate_allowed_command(cmd: str) -> bool:
    if not gate_active or not cmd.strip():
        return False
    norm = normalized_command(cmd)
    return any(norm == allowed or norm.endswith(f"&& {allowed}") or norm.endswith(f"; {allowed}") for allowed in allowed_commands)


def forbidden_gate_violation(cmd: str) -> str:
    lower = cmd.lower()
    explicit_fragments = [
        "migrate deploy",
        "migrate resolve",
        "db push",
        "git push",
    ]
    for fragment in explicit_fragments:
        if fragment in lower:
            return fragment
    if re.search(r"\b(prod|production)\b", lower):
        if any("production" in entry or "prod" in entry for entry in forbidden_entries):
            return "production/prod"
    return ""


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
if root.name == "kody-workspace":
    protected_paths.extend(["kody-frontend/", "kody-backend/"])
if root.name == "kody-backend":
    protected_paths.extend(["prisma/schema.prisma", "prisma/migrations/"])

write_tools = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
if tool_name in write_tools or ("file_path" in tool_input and not command):
    candidate_paths = [
        str(tool_input.get("file_path") or ""),
        str(tool_input.get("path") or ""),
        str(tool_input.get("notebook_path") or ""),
    ]
    for edit in tool_input.get("edits") or []:
        if isinstance(edit, dict):
            candidate_paths.extend([
                str(edit.get("file_path") or ""),
                str(edit.get("path") or ""),
            ])
    candidate_paths = [p for p in candidate_paths if p]
    joined_paths = " ".join(candidate_paths)
    protected_hit = any(item in joined_paths for item in protected_paths)
    if protected_hit:
        all_gate_allowed = gate_active and candidate_paths and all(is_gate_allowed_path(p) for p in candidate_paths)
        if not all_gate_allowed:
            print("Hermes safety adapter blocked edit to protected path or generated/dependency surface.", file=sys.stderr)
            sys.exit(2)

if tool_name == "Bash" or command:
    normalized = f" {command.lower()} "
    gate_forbidden = forbidden_gate_violation(command)
    if gate_forbidden:
        print(f"Hermes safety adapter blocked forbidden gate command: {gate_forbidden}.", file=sys.stderr)
        sys.exit(2)
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
    if any(fragment in normalized for fragment in dangerous_fragments) or re.search(r"\b(insert\s+into|update|delete\s+from|alter\s+table|drop\s+(database|schema|table)|truncate)\b", command.lower()):
        if not is_gate_allowed_command(command):
            print("Hermes safety adapter blocked destructive or database-mutating command.", file=sys.stderr)
            sys.exit(2)
PY
