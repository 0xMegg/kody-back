# Hermes Claude CLI Invocation Policy

Status: Recommended.

When Codex Desktop or another GUI-launched agent invokes Claude Code, treat command entry and workspace access as separate checks.

Use the Claude executable by absolute path when the launcher environment may not include Homebrew or nvm paths. For this workspace, the known executable is `/opt/homebrew/bin/claude`.

Run Claude from the project directory whose files it must inspect. If one Claude review must inspect multiple project directories, grant only those directories for that invocation with `--add-dir`.

Do not add broad cross-project read patterns such as `/Users/mero/Dev/**` to Claude user settings. Cross-project access should be scoped per invocation.

## Source Provenance

- Codex Desktop environment inspection on 2026-05-04 showed `PATH` omitted `/opt/homebrew/bin` and the active nvm Node bin.
- `/opt/homebrew/bin/claude --version` and `auth status` succeeded while `claude --version` failed with `command not found`.
- Claude `-p` could read files under its current working directory, could not read a sibling project absolute path, and succeeded after either changing working directory or adding the target with `--add-dir`.
- Claude CLI help states that non-interactive `-p` skips the workspace trust dialog and that `--add-dir` allows additional directories.
- Claude review on 2026-05-04 accepted the root-cause split: command-entry failure from GUI PATH, then workspace read denial from missing cwd or `--add-dir`.

## Scope

This policy applies when Hermes asks Claude Code to review, plan, inspect files, or otherwise act from Codex Desktop or another non-login-shell launcher.

It does not require bypassing Claude permissions, changing global Claude settings, or weakening project isolation.

## Diagnostic Order

First check whether Claude started:

- If `claude` is not found, use the known absolute executable path.
- If the absolute executable fails authentication, treat it as a Claude auth issue.

Then check whether Claude can access the files:

- If the target files are in one project, run Claude with that project as the working directory.
- If the target files span multiple projects, keep the working directory narrow and add only the needed extra directories with `--add-dir`.
- If Claude reports a read-permission denial, do not treat it as an auth failure.

## Blocked Patterns

- Broad permanent read grants across all project directories.
- Treating `claude -p` as permission bypass for files outside the workspace.
- Using login-shell wrappers as the default fix for GUI PATH drift.
- Collapsing `command not found`, `Not logged in`, and file read denial into one generic "Claude failed" diagnosis.

## Recording

If a Claude review is skipped or delayed because of PATH, authentication, or workspace access, record which layer failed and how it was resolved in the project log.
