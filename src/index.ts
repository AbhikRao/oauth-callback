/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * OAuth 2.0 authorization code flow handler for Node.js, Deno, and Bun.
 * Creates a temporary localhost server to capture OAuth callbacks for CLI/desktop apps.
 */

import { OAuthError } from "./errors";
import { createCallbackServer, type CallbackResult } from "./server";
import type { GetAuthCodeOptions } from "./types";

const DEFAULT_PORT = 3000;
const DEFAULT_HOSTNAME = "localhost";
const DEFAULT_CALLBACK_PATH = "/callback";

export type { CallbackResult, CallbackServer, ServerOptions } from "./server";
export { OAuthError, TimeoutError } from "./errors";
export type { GetAuthCodeOptions } from "./types";

// Storage implementations (backward compatibility)
export { inMemoryStore } from "./storage/memory";
export { fileStore } from "./storage/file";

// MCP namespace export
import * as mcp from "./mcp";
export { mcp };

/**
 * Builds the redirect URI for OAuth configuration.
 * Use this to construct the redirect_uri parameter for your authorization URL.
 *
 * @example
 * ```typescript
 * const redirectUri = getRedirectUrl({ port: 3000 });
 * // => "http://localhost:3000/callback"
 *
 * const authUrl = `https://oauth.example.com/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
 * console.log('Open:', authUrl);
 * await getAuthCode({ authorizationUrl: authUrl, launch: false, port: 3000 });
 * ```
 */
export function getRedirectUrl(
  options: {
    port?: number;
    hostname?: string;
    callbackPath?: string;
  } = {},
): string {
  const {
    port = DEFAULT_PORT,
    hostname = DEFAULT_HOSTNAME,
    callbackPath = DEFAULT_CALLBACK_PATH,
  } = options;
  return `http://${hostname}:${port}${callbackPath}`;
}

/**
 * Reads the state the callback must echo (ADR-004). Rejects duplicate or empty
 * state so the library and the authorization server can't disagree on its value.
 */
function getExpectedState(authorizationUrl: string): string | undefined {
  const states = new URL(authorizationUrl).searchParams.getAll("state");
  if (states.length > 1)
    throw new TypeError("authorizationUrl must contain at most one state");
  if (states[0] === "")
    throw new TypeError("authorizationUrl state must not be empty");
  return states[0];
}

/** Default launcher; `open` is loaded only when a browser is actually opened. */
async function openBrowser(authorizationUrl: string): Promise<unknown> {
  const { default: open } = await import("open");
  return open(authorizationUrl);
}

/**
 * Captures OAuth authorization code via localhost callback.
 * Starts a temporary server, launches the auth URL (unless `launch: false`),
 * and waits for the redirect.
 *
 * When `authorizationUrl` contains `state`, only callbacks echoing it complete
 * the flow; others get HTTP 400 while the server keeps waiting (ADR-004).
 *
 * @param input - Auth URL string (same as `launch: true`) or GetAuthCodeOptions
 * @returns Promise<CallbackResult> with code and params
 * @throws {OAuthError} Provider errors (access_denied, invalid_scope)
 * @throws {TimeoutError} No valid callback within `timeout`
 * @throws {Error} Network failures, port conflicts, cancellation
 *
 * @example
 * ```typescript
 * const authUrl = 'https://oauth.example.com/authorize?...';
 *
 * // Library opens the system browser
 * const result = await getAuthCode({ authorizationUrl: authUrl, launch: true });
 *
 * // Manual launch: caller shows the URL
 * console.log('Open this URL:', authUrl);
 * const result = await getAuthCode({ authorizationUrl: authUrl, launch: false });
 * ```
 */
export async function getAuthCode(
  input: GetAuthCodeOptions | string,
): Promise<CallbackResult> {
  const options: GetAuthCodeOptions =
    typeof input === "string"
      ? { authorizationUrl: input, launch: true }
      : input;

  const {
    port = DEFAULT_PORT,
    hostname = DEFAULT_HOSTNAME,
    timeout = 30000,
    callbackPath = DEFAULT_CALLBACK_PATH,
    successHtml,
    errorHtml,
    signal,
    onRequest,
  } = options;

  // Derived rather than passed separately so a URL carrying state can't skip validation.
  const expectedState = getExpectedState(options.authorizationUrl);

  const server = createCallbackServer();

  try {
    await server.start({
      port,
      hostname,
      successHtml,
      errorHtml,
      signal,
      onRequest,
    });

    // An abort during start() already stopped the server; without this check
    // the listener below would wait on a dead server until the timeout.
    if (signal?.aborted) throw new Error("Operation aborted");

    // Register the listener (and start the timeout) before launching, so a
    // fast redirect can't beat it.
    const callbackPromise = server.waitForCallback(
      callbackPath,
      timeout,
      expectedState,
    );

    // Best-effort launch: deferred so synchronous throws are swallowed too.
    const { launch, authorizationUrl } = options;
    if (launch) {
      const launcher = launch === true ? openBrowser : launch;
      void Promise.resolve()
        .then(() => launcher(authorizationUrl))
        .catch(() => {});
    }

    const result = await callbackPromise;

    // OAuth errors must be thrown, not returned
    if (result.error) {
      throw new OAuthError(
        result.error,
        result.error_description,
        result.error_uri,
      );
    }

    return result;
  } finally {
    await server.stop();
  }
}
