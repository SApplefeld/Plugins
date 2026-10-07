---
name: systematic-debugging
description: "Root-cause debugging discipline. Use whenever investigating a bug, failure, unexpected behavior, failing test, or production incident - BEFORE proposing any fix. Triggers include 'bug', 'broken', 'failing', 'why is this happening', error reports, and especially any situation where a previous fix attempt did not work. Skip only for trivial fixes where the cause is directly visible."
---

# Systematic Debugging

The iron rule: **no fix without a reproduced, understood root cause.** This is the one workflow where gating is deliberate.

## Phase 0: Classify

Before reproducing, decide whether the failure lives in the code or outside it. Never change working code to route around an environment problem.

## Phase 1: Reproduce

Reproduce the failure reliably before investigating, with a minimal temporary script or test per the doctrine's "Make the test earn its green" bullet. If it will not reproduce, gather evidence by logging, narrowing inputs and comparing environments. "I can't reproduce it but this change should help" is never an outcome.

## Phase 2: Investigate

Build the evidence before forming opinions:

- **Read the actual error** whole. Check the project's server-side error log or audit table for the server-side view.
- **Trace the data flow backward**, dispatching the Explore subagent for unfamiliar territory rather than guessing.
- **SQL-specific checks** on this stack:
  - Deployment drift: does the deployed object match source? (shell-then-ALTER means a missed deployment leaves a stale proc silently in place - compare `sys.sql_modules` against the file).
  - Security context: is a trigger or nested call running as the caller instead of the impersonated user? `WITH EXECUTE AS` boundaries are a classic invisible cause.
  - Actual data: query it for the shape nobody believed existed, such as NULLs, duplicates, or empty strings vs NULL.
  - Isolation level: READ UNCOMMITTED procs can return mid-transaction state; confirm the proc's declared level matches its use.

## Phase 3: Hypothesize and Test

State one hypothesis at a time: "X causes Y because Z." Test it with the smallest check that can falsify it, such as a query, a log line or a one-variable change. Never bundle changes.

## Phase 4: Fix the Cause

Fix the cause, not the symptom, and verify the repro now passes. The doctrine's After-each-step and Close-each-section bullets own the lane, the kit memory store write and the Chapter that follow.

## Escalation

**Two failed fixes mean the mental model is wrong - stop.** List every assumption in play and verify each against evidence. Widen the frame to the design, the spec, the deployment and the data, not just the suspect code. Convene a consult on the dead end before you stop and report. The consult skill (`consult/SKILL.md`) owns the triggers and mechanics. The stop and the report still happen, carrying the consult's ruling. A root cause implicating a design decision comes to me with the evidence and the ruling, never patched around quietly.

## When Not to Use

A directly visible cause with a trivial fix, such as a typo, skips the phases and is fixed under the doctrine's rules. A failed first fix means you are now debugging, so use this skill.
