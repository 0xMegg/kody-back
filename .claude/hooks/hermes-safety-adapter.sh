#!/usr/bin/env bash
set -euo pipefail
payload="$(cat || true)"
python3 - "$PWD" "$payload" <<'PY'
import json, os, posixpath, sys
from pathlib import Path

root = sys.argv[1]
payload = sys.argv[2]
try:
    data = json.loads(payload) if payload.strip() else {}
except json.JSONDecodeError:
    data = {}

tool_name = data.get("tool_name") or data.get("toolName") or ""
tool_input = data.get("tool_input") or data.get("toolInput") or {}
command = tool_input.get("command") or tool_input.get("cmd") or ""


def normalize_command(value):
    return " ".join(str(value or "").strip().split())


def normalize_repo_path(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    root_path = Path(root).resolve()
    candidate = Path(raw)
    if candidate.is_absolute():
        try:
            raw = str(candidate.resolve().relative_to(root_path))
        except ValueError:
            return ""
    raw = raw.replace(os.sep, "/")
    normalized = posixpath.normpath(raw)
    if normalized in (".", ""):
        return ""
    parts = normalized.split("/")
    if any(part == ".." for part in parts):
        return ""
    return normalized


def load_prisma_gate():
    if not root.endswith("kody-backend"):
        return None
    gate_path = Path(root).resolve().parent / ".hermes" / "gates" / "prisma-active-gate.json"
    try:
        gate = json.loads(gate_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(gate, dict):
        return None
    if gate.get("active") is not True:
        return None
    if gate.get("targetRepo") != "kody-backend":
        return None
    if gate.get("approvedByUser") is not True:
        return None
    reviews = gate.get("reviews") if isinstance(gate.get("reviews"), dict) else {}
    gpt_review = reviews.get("gptCodex") if isinstance(reviews.get("gptCodex"), dict) else {}
    opus_review = reviews.get("opus") if isinstance(reviews.get("opus"), dict) else {}
    if gpt_review.get("status") != "approved" or opus_review.get("status") != "approved":
        return None
    return gate


PRISMA_GATE = load_prisma_gate()


def is_allowed_prisma_path(path_value):
    if PRISMA_GATE is None:
        return False
    candidate = normalize_repo_path(path_value)
    if not candidate:
        return False
    allowed_paths = PRISMA_GATE.get("allowedWritePaths")
    if not isinstance(allowed_paths, list):
        return False
    for allowed in allowed_paths:
        allowed_raw = str(allowed or "").strip().replace(os.sep, "/")
        if not allowed_raw:
            continue
        if ".." in allowed_raw.split("/"):
            continue
        if allowed_raw.endswith("/"):
            allowed_prefix = posixpath.normpath(allowed_raw.rstrip("/")) + "/"
            if candidate.startswith(allowed_prefix):
                return True
        else:
            if candidate == posixpath.normpath(allowed_raw):
                return True
    return False


def is_allowed_prisma_command(command_value):
    if PRISMA_GATE is None:
        return False
    candidate = normalize_command(command_value)
    allowed_commands = PRISMA_GATE.get("allowedCommands")
    if not isinstance(allowed_commands, list):
        return False
    return any(candidate == normalize_command(allowed) for allowed in allowed_commands)


base_protected_paths = [
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
root_protected_paths = []
backend_prisma_paths = []
if root.endswith("kody-workspace"):
    root_protected_paths.extend(["kody-frontend/", "kody-backend/"])
if root.endswith("kody-backend"):
    backend_prisma_paths.extend(["prisma/schema.prisma", "prisma/migrations/"])


def path_matches_protected(candidate, protected):
    joined = str(candidate or "")
    return any(item in joined for item in protected)


write_tools = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
if tool_name in write_tools or ("file_path" in tool_input and not command):
    candidate_paths = [
        str(tool_input.get("file_path") or ""),
        str(tool_input.get("path") or ""),
        str(tool_input.get("notebook_path") or ""),
    ]
    joined_paths = " ".join(candidate_paths)
    if path_matches_protected(joined_paths, base_protected_paths + root_protected_paths):
        print("Hermes safety adapter blocked edit to protected path or generated/dependency surface.", file=sys.stderr)
        sys.exit(2)
    if path_matches_protected(joined_paths, backend_prisma_paths):
        if not any(is_allowed_prisma_path(path) for path in candidate_paths):
            print("Hermes safety adapter blocked edit to protected Prisma schema/migration surface.", file=sys.stderr)
            sys.exit(2)

if tool_name == "Bash" or command:
    destructive_fragments = [
        " rm -rf ",
        " git reset --hard",
        " git clean -fd",
        " git push --force",
        " git push -f",
    ]
    database_fragments = [
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
    normalized = f" {str(command).lower()} "
    if any(fragment in normalized for fragment in destructive_fragments):
        print("Hermes safety adapter blocked destructive command.", file=sys.stderr)
        sys.exit(2)
    if any(fragment in normalized for fragment in database_fragments):
        if not is_allowed_prisma_command(command):
            print("Hermes safety adapter blocked destructive or database-mutating command.", file=sys.stderr)
            sys.exit(2)
PY
