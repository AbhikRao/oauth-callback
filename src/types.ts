/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Configuration options for OAuth authorization code flow
 */
export interface GetAuthCodeOptions {
  /**
   * OAuth authorization URL that the user will be redirected to.
   * Should include all necessary query parameters like client_id, redirect_uri, etc.
   * If it contains `state`, callbacks must echo exactly that value (ADR-004).
   */
  authorizationUrl: string;

  /**
   * How the authorization URL is opened:
   * - `true`: the system browser (via the bundled `open` package)
   * - `false`: not at all; the caller shows the URL to the user
   * - function: a custom launcher
   *
   * Required so adding other options can't silently change launch behavior.
   * Called once the callback listener is ready, best-effort (errors are swallowed).
   *
   * Returns `unknown` (not `void`) to accept any launcher without casting—e.g.,
   * the `open` package returns `Promise<ChildProcess>`. Return value is ignored.
   *
   * @example
   * ```typescript
   * await getAuthCode({ authorizationUrl: url, launch: true, timeout: 60000 });
   * ```
   */
  launch: boolean | ((authorizationUrl: string) => unknown);

  /**
   * Port for the local callback server. Make sure this matches the
   * redirect_uri registered with your OAuth provider.
   * @default 3000
   */
  port?: number;

  /**
   * Hostname to bind the server to. Should typically be "localhost" or "127.0.0.1"
   * for security reasons to prevent external access.
   * @default "localhost"
   */
  hostname?: string;

  /**
   * URL path for the OAuth callback. Must match the path in your registered
   * redirect_uri with the OAuth provider.
   * @default "/callback"
   */
  callbackPath?: string;

  /**
   * Timeout in milliseconds to wait for OAuth callback.
   * Starts when the callback server is ready; launch timing does not delay it.
   * @default 30000
   */
  timeout?: number;

  /**
   * Custom HTML content to display when authorization is successful.
   * If not provided, a default success page with auto-close functionality is used.
   */
  successHtml?: string;

  /**
   * Custom HTML template to display when authorization fails.
   * Supports placeholders: {{error}}, {{error_description}}, {{error_uri}}
   * (HTML-escaped; {{error_uri}} is empty unless http(s)).
   * If not provided, a default error page is used.
   */
  errorHtml?: string;

  /**
   * AbortSignal for cancellation support. Allows you to cancel the
   * OAuth flow programmatically (e.g., on user request or timeout).
   */
  signal?: AbortSignal;

  /**
   * Callback function fired when any HTTP request is received by the server.
   * Useful for logging, debugging, or custom request handling.
   * @param req - The incoming HTTP request
   */
  onRequest?: (req: Request) => void;
}
