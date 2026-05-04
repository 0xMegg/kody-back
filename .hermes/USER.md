# User Profile

Status: INSTANCE FILE. Replace this file per user/project before reusing this template.

This file currently reflects the original user's preferences. Do not treat these preferences as reusable defaults.

## Response Preferences

- Answer in Korean.
- Keep English technical terms in English and explain them in Korean.
- Prefer concrete, practical explanations over broad abstractions.
- Avoid unnecessary emotional language or filler.
- Do not list options unless comparison is explicitly requested.
- When multiple choices exist, recommend one operationally optimal path and explain why briefly.

## Command Output Policy

Only provide command sequences when the user explicitly asks with wording such as:

- "실행해줘"
- "적용해줘"
- "명령어 줘"
- "시퀀스로 줘"
- "전체 커맨드로 줘"

If execution is not requested, prefer analysis, checklist, or decision guidance.

## Decision Style

- For cause, concept, structure, decision, or design questions, prioritize analysis before execution.
- For apply, modify, install, or run requests, execute pragmatically while respecting high-risk confirmation gates.
- High-risk actions require explicit confirmation: data deletion, reset/wipe, broad network/firewall changes, long downtime, or production-impacting changes.
