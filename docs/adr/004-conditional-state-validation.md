# ADR-004: Conditional OAuth State Validation

**Status:** Accepted
**Date:** 2025-01-25
**Updated:** 2026-09-24
**Tags:** oauth, security, csrf

## Problem

- RFC 6749 recommends `state` for CSRF protection, but RFC 8252 (native apps) also relies on loopback redirects.
- Some authorization servers don't echo `state` back; others require it.
- A localhost callback endpoint can be reached by stale browser tabs or other local processes.
- Rejecting a mismatched state only after the first callback has already resolved still lets an unrelated request terminate a legitimate authorization flow.

## Decision

- Validate `state` only when an expected value is provided.
- `getAuthCode()` accepts an optional `expectedState`.
- When `expectedState` is set, a callback must contain exactly one `state` value and it must match.
- Callback shape is validated before the waiting promise resolves: exactly one non-empty `code` with no `error`, or exactly one non-empty `error` with no `code`.
- Invalid callbacks receive HTTP 400 and an error page, but the callback listener and original timeout remain active.
- A valid provider `error` callback still ends the flow and becomes an `OAuthError`.
- `browserAuth()` passes the state from the authorization URL to `getAuthCode()` as `expectedState`. It does not perform a post-hoc mismatch check.
- If the authorization URL omits `state`, callbacks are accepted without state matching.

Rationale:

- **Defense-in-depth**: State protects against unrelated local callbacks in addition to the loopback binding.
- **Do not let invalid traffic win the race**: A malformed, stale, or mismatched callback cannot consume the one callback the application is waiting for.
- **Unambiguous parsing**: Duplicate security-sensitive parameters are rejected instead of being flattened to an arbitrary value.
- **Compatibility**: Callers that do not supply `expectedState` retain flows that do not use state.

## Alternatives (brief)

- **Validate after resolving** — Detects a mismatch but still aborts the real login flow.
- **Always require state** — Breaks servers or callers that do not use state.
- **Never validate state** — Leaves the loopback callback vulnerable to unrelated local requests.
- **Generate state internally always** — Conflicts with authorization URLs whose state is already managed by the MCP SDK or caller.

## Impact

- Positive: Invalid or mismatched callbacks no longer terminate an otherwise valid authorization attempt.
- Positive: Duplicate `code`, `error`, or required `state` values are rejected as ambiguous.
- Positive: Provider errors with a matching state preserve existing `OAuthError` behavior.
- Negative/Risks: Callers that want state validation must provide `expectedState` (directly, or through `browserAuth()`).

## Links

- Code: `src/server.ts`, `src/index.ts`, `src/auth/browser-auth.ts`
- RFC 6749 Section 10.12 (CSRF Protection)
- RFC 8252 Section 8.1 (Loopback Redirect)
