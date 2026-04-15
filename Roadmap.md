# Roadmap

## Context

This roadmap is based on a deeper code audit focused on security, stability, and implementation quality.
The first stage focuses on eliminating critical issues and preparing a solid baseline for further optimization.

## Stage 1 — Resolve Core Security and Code Quality Issues

Status: `completed`  
Stage priority: `highest`

### Stage goals

1. Fix path traversal vulnerabilities and weak access control boundaries.
2. Reduce regression risk through baseline quality gate normalization.
3. Remove clear architectural and code issues: duplication, dead code, overloaded modules.
4. Define measurable completion criteria before moving to the next stages.

---

## Backlog (Stage 1)

### P0 — Security and data integrity

1. **Fix path traversal in project file listing**
   - File: `src/lib/storage/project-store.ts` (`getProjectFiles`)
   - Actions:
     - Validate that resolved target paths always remain inside `getWorkDir(projectId)`.
     - Reject `subPath` values that escape the project boundary.
   - Done criteria:
     - It is impossible to list directories outside the current project via `GET /api/files`.

2. **Harden path boundary checks in file download/delete APIs**
   - Files: `src/app/api/files/route.ts`, `src/app/api/files/download/route.ts`
   - Actions:
     - Replace simple `startsWith(base)` checks with a safe normalized directory-boundary strategy.
   - Done criteria:
     - Access attempts to sibling/outside directories are consistently rejected across target scenarios.

3. **Narrow Telegram API public surface in middleware**
   - File: `middleware.ts`
   - Actions:
     - Remove broad public `POST` allowance for the entire `/api/integrations/telegram` prefix.
     - Keep only true webhook/integration endpoints public when external calls are required.
   - Done criteria:
     - New internal Telegram routes are not public by default.

4. **Sanitize file names in Knowledge API**
   - File: `src/app/api/projects/[id]/knowledge/route.ts`
   - Actions:
     - Normalize/sanitize both `file.name` and `filename`.
     - Add explicit checks that final paths always stay inside `.meta/knowledge`.
   - Done criteria:
     - Writing/deleting files outside the knowledge directory is impossible.

---

### P1 — Operational risk reduction

5. **Harden user-provided `subdir` validation in memory API**
   - File: `src/app/api/memory/route.ts`
   - Actions:
     - Introduce an allowlist/schema for `subdir`.
     - Prevent traversal into other contexts/directories.
   - Done criteria:
     - Accessing another context’s memory via path-like values is impossible.

6. **Remove unsafe session secret fallback**
   - File: `src/lib/auth/session.ts`
   - Actions:
     - Disallow default hardcoded secret usage in production.
     - Require explicit `EGGENT_AUTH_SECRET`.
   - Done criteria:
     - The app cannot run with an insecure session-secret configuration.

7. **Reduce external API token exposure risk**
   - File: `src/app/api/external/token/route.ts`
   - Actions:
     - Rework full-token response behavior and rotation flow.
     - Clarify one-time reveal/masking behavior in responses and logs.
   - Done criteria:
     - Token is not repeatedly exposed in plain text without explicit rotation.

8. **Define and document policy for dangerous agent tools**
   - Files: `src/lib/tools/tool.ts`, `src/lib/tools/code-execution.ts`, `src/lib/mcp/client.ts`
   - Actions:
     - Add explicit restrictions for dangerous tools in production mode.
     - Define a minimal safe default enabled tool set.
   - Done criteria:
     - Production has a clear and safe default tool profile.

---

### P1/P2 — Unoptimized and potentially dead code

9. **Decompose `agent.ts`**
   - File: `src/lib/agent/agent.ts`
   - Actions:
     - Extract separate modules for recovery/loop-guard/conversion/persistence.
     - Reduce cognitive complexity and file size.
   - Done criteria:
     - Core orchestration module becomes smaller and easier to review.

10. **Remove duplication in Telegram integration APIs**
    - Files: `src/app/api/integrations/telegram/*.ts`
    - Actions:
      - Extract repeated Telegram API call/error parsing logic into a shared helper.
    - Done criteria:
      - Duplicate logic is removed and behavior is unified.

11. **Remove duplication around external session/project checks**
    - Files: `src/lib/external/handle-external-message.ts`, `src/app/api/integrations/telegram/route.ts`
    - Actions:
      - Move repeated context resolution/checking logic into a shared layer.
    - Done criteria:
      - Single implementation of context logic instead of multiple divergent copies.

12. **Verify and remove unused exports/legacy aliases**
    - Candidate file: `src/lib/storage/project-store.ts` (`getProjectInstructionsDir`)
    - Actions:
      - Confirm there are no active consumers.
      - Remove it or keep it explicitly as compatibility API with a clear contract.
    - Done criteria:
      - No dangling public APIs without consumers or a clear reason to exist.

13. **Reduce I/O cost for chat and memory reads**
    - Files: `src/lib/storage/chat-store.ts`, `src/lib/memory/memory.ts`
    - Actions:
      - Design an index/cache strategy for list-heavy operations.
      - Reduce full large-JSON rewrites frequency.
    - Done criteria:
      - Observable response-time reduction on list/search operations as data volume grows.

---

## Definition of Done for Stage 1

Stage is considered complete when all of the following are true:

1. All P0 tasks are completed.
2. P1 changes that affect production security are implemented and documented.
3. Lint and build pass predictably without masking new regressions.
4. Critical fixes are covered with verifiable checks (minimum smoke/integration).
5. Confirmed duplicates and dead code from P1/P2 are removed.

---

## Recommended execution order

1. P0.1 → P0.2 → P0.4  
2. P0.3 → P1.5 → P1.6  
3. P1.7 → P1.8  
4. P1/P2.10 → P1/P2.11 → P1/P2.12  
5. P1/P2.9 → P1/P2.13

