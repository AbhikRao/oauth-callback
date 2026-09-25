# ADR-004: Conditional OAuth State Validation

**Status:** Accepted
**Date:** 2025-01-25
**Updated:** 2026-09-25
**Tags:** oauth, security, csrf

## Problem

- RFC 6749 recommends `state` for CSRF protection, but RFC 8252 (native apps) also relies on loopback redirects.
- Some authorization flows don't use `state`; others require it.
- A localhost callback endpoint can be reached by stale browser tabs or other local processes.
- Rejecting a mismatched state only after the first callback has already resolved still lets an unrelated request terminate a legitimate authorization flow.

## Decision

- `getAuthCode()` requires `authorizationUrl` and derives the expected state from it; there is no separate option to forget. `launch` is required too (`true` for the system browser, `false` when the caller shows the URL, or a custom function), so adding options can't silently change launch behavior.
- An authorization URL with duplicate or empty `state` throws `TypeError` before the server starts, keeping one unambiguous value on both sides.
- If the authorization URL has `state`, a callback must contain exactly that one value.
- A callback with more than one `state` is always rejected.
- Callback shape is validated before the waiting promise resolves: exactly one non-empty `code` with no `error`, or exactly one non-empty `error` with no `code`.
- Invalid callbacks receive HTTP 400 with neutral plain text (not the error page, since the real flow may still succeed), and the listener and original timeout remain active.
- A valid provider `error` callback still ends the flow and becomes an `OAuthError`.
- `browserAuth()` always passes the authorization URL to `getAuthCode()`, opening the system browser when no launcher is configured.
- If the authorization URL omits `state`, callbacks are accepted without state matching.

Rationale:

- **Defense-in-depth**: State protects against unrelated local callbacks in addition to the loopback binding.
- **Do not let invalid traffic win the race**: A malformed, stale, or mismatched callback cannot consume the one callback the application is waiting for.
- **Unambiguous parsing**: Duplicate security-sensitive parameters are rejected instead of being flattened to an arbitrary value.
- **Safe by default**: Validation follows the authorization request itself, so a URL with `state` is always checked.
- **Protocol compatibility**: Flows without `state` keep working.

## Alternatives (brief)

- **Validate after resolving** — Detects a mismatch but still aborts the real login flow.
- **Always require state** — Breaks servers or callers that do not use state.
- **Never validate state** — Leaves the loopback callback vulnerable to unrelated local requests.
- **Separate `expectedState` option** — Duplicates what the URL already says and makes validation opt-in.
- **`getAuthCode(url, options)` with implicit launch** — Compact, but launch behavior becomes implicit when options are added; the object form intentionally requires an explicit launch policy.
- **Generate state internally always** — Conflicts with authorization URLs whose state is already managed by the MCP SDK or caller.

## Impact

- Positive: Invalid or mismatched callbacks no longer terminate an otherwise valid authorization attempt.
- Positive: Duplicate `code`, `error`, or required `state` values are rejected as ambiguous.
- Positive: Provider errors with a matching state preserve existing `OAuthError` behavior.
- Negative/Risks: Breaking change: callers that ran the server without an authorization URL must now pass it with `launch: false`.

## Links

- Code: `src/server.ts`, `src/index.ts`, `src/auth/browser-auth.ts`
- RFC 6749 Section 10.12 (CSRF Protection)
- RFC 8252 Section 7.3 (Loopback Interface Redirection), Section 8.3 (Loopback Redirect Considerations)
