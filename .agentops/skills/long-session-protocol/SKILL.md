---
name: long-session-protocol
description: Protocol for managing extended forge-mcp development sessions
license: MIT
metadata: { "author": "AgentOps" }
---

# Skill: long-session-protocol

Protocol for managing extended forge-mcp development sessions.

## Triggers
- "start a session for X"
- "this will take a while"
- multi-step implementation tasks

## Procedure
1. Write current state to `docs/ACTIVE_SESSION.md`
2. Commit `docs/ACTIVE_SESSION.md` with state snapshot
3. Create detailed task breakdown
4. Execute tasks in order, committing after each
5. Update ACTIVE_SESSION.md with progress
6. On completion, archive ACTIVE_SESSION.md
