---
title: getAuthCode
description: Core function for capturing OAuth authorization codes via localhost callback in CLI tools and desktop applications.
---

# getAuthCode

The `getAuthCode` function is the primary API for capturing OAuth authorization codes through a localhost callback. It handles the entire OAuth flow: starting a local server, opening the browser, waiting for the callback, and returning the authorization code.

## Function Signature

```typescript
function getAuthCode(
  input: string | GetAuthCodeOptions,
): Promise<CallbackResult>;
```

## Parameters

The function accepts either:

- A **string** containing the OAuth authorization URL (uses default options)
- A **GetAuthCodeOptions** object for advanced configuration

### GetAuthCodeOptions

| Property           | Type                                                 | Default       | Description                                                             |
| ------------------ | ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `authorizationUrl` | `string`                                             | _required_    | OAuth authorization URL with query parameters                           |
| `port`             | `number`                                             | `3000`        | Port for the local callback server                                      |
| `hostname`         | `string`                                             | `"localhost"` | Hostname to bind the server to                                          |
| `callbackPath`     | `string`                                             | `"/callback"` | URL path for OAuth callback                                             |
| `timeout`          | `number`                                             | `30000`       | Timeout in milliseconds                                                 |
| `launch`           | `boolean \| ((authorizationUrl: string) => unknown)` | _required_    | `true`: system browser; `false`: you show the URL; or a custom launcher |
| `successHtml`      | `string`                                             | _built-in_    | Custom HTML for successful auth                                         |
| `errorHtml`        | `string`                                             | _built-in_    | Custom HTML template for errors                                         |
| `signal`           | `AbortSignal`                                        | _none_        | For programmatic cancellation                                           |
| `onRequest`        | `(req: Request) => void`                             | _none_        | Callback for request logging                                            |

## Return Value

Returns a `Promise<CallbackResult>` with the callback's query parameters.
On successful resolution, `code` is always present; provider errors are thrown
as `OAuthError` instead.

## Exceptions

The function can throw:

| Error Type     | Condition            | Description                                                     |
| -------------- | -------------------- | --------------------------------------------------------------- |
| `OAuthError`   | OAuth provider error | Contains `error`, `error_description`, and optional `error_uri` |
| `TimeoutError` | Timeout              | No valid callback within `timeout`                              |
| `Error`        | Port in use          | "EADDRINUSE" - port already occupied                            |
| `Error`        | Cancellation         | Flow cancelled via `AbortSignal`                                |

## Basic Usage

### With Browser Launch

The recommended usage with automatic browser opening:

```typescript
import { getAuthCode } from "oauth-callback";

const authUrl =
  "https://github.com/login/oauth/authorize?" +
  new URLSearchParams({
    client_id: "your_client_id",
    redirect_uri: "http://localhost:3000/callback",
    scope: "user:email",
    state: "random_state",
  });

const result = await getAuthCode({ authorizationUrl: authUrl, launch: true });
console.log("Authorization code:", result.code);
console.log("State:", result.state);
```

### With Configuration Object

Using the options object for more control:

```typescript
const result = await getAuthCode({
  authorizationUrl: authUrl,
  launch: true,
  port: 8080,
  timeout: 60000,
  hostname: "127.0.0.1",
});
```

## Advanced Usage

### Custom Port Configuration

When port 3000 is unavailable or you've registered a different redirect URI:

```typescript
const result = await getAuthCode({
  authorizationUrl: "https://oauth.example.com/authorize?...",
  launch: true,
  port: 8888,
  callbackPath: "/oauth/callback", // Custom path
  hostname: "127.0.0.1", // Specific IP binding
});
```

::: warning Port Configuration
Ensure the port and path match your OAuth app's registered redirect URI:

- Registered: `http://localhost:8888/oauth/callback`
- Configuration must use: `port: 8888`, `callbackPath: "/oauth/callback"`
  :::

### Custom HTML Templates

Provide branded success and error pages:

```typescript
const result = await getAuthCode({
  authorizationUrl: authUrl,
  launch: true,
  successHtml: `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Success!</title>
        <style>
          body { 
            font-family: system-ui; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
        </style>
      </head>
      <body>
        <div>
          <h1>✨ Authorization Successful!</h1>
          <p>You can close this window and return to the app.</p>
        </div>
      </body>
    </html>
  `,
  errorHtml: `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Authorization Failed</h1>
        <p>Error: {{error}}</p>
        <p>{{error_description}}</p>
        <a href="{{error_uri}}">More information</a>
      </body>
    </html>
  `,
});
```

::: tip Template Placeholders
Error templates support these placeholders:

- `{{error}}` - OAuth error code
- `{{error_description}}` - Human-readable description
- `{{error_uri}}` - Link to error documentation (empty unless `http(s)`)

Values come from the callback URL, so they are HTML-escaped before insertion.
:::

### Request Logging

Monitor OAuth flow for debugging:

```typescript
const result = await getAuthCode({
  authorizationUrl: authUrl,
  launch: true,
  onRequest: (req) => {
    const url = new URL(req.url);
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`);
  },
});
```

### Timeout Handling

Configure timeout for different scenarios:

```typescript
try {
  const result = await getAuthCode({
    authorizationUrl: authUrl,
    launch: true,
    timeout: 120000, // 2 minutes for first-time users
  });
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error("Authorization took too long. Please try again.");
  }
}
```

### Programmatic Cancellation

Support user-initiated cancellation:

```typescript
const controller = new AbortController();

// Listen for Ctrl+C
process.on("SIGINT", () => {
  console.log("\nCancelling authorization...");
  controller.abort();
});

// Set a maximum time limit
const timeoutId = setTimeout(() => {
  console.log("Authorization time limit reached");
  controller.abort();
}, 300000); // 5 minutes

try {
  const result = await getAuthCode({
    authorizationUrl: authUrl,
    launch: true,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);
  console.log("Success! Code:", result.code);
} catch (error) {
  if (controller.signal.aborted) {
    console.log("Authorization was cancelled");
  }
}
```

### Manual Browser Launch

Pass `launch: false` to show the URL yourself. The browser must still run on
the machine hosting the callback server, since the redirect targets `localhost`.

```typescript
// Manual launch - print URL, let user open it
const redirectUri = "http://localhost:3000/callback";
const authUrl = `https://oauth.example.com/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;

console.log("Please open this URL in your browser:");
console.log(authUrl);

// Server waits for callback without opening browser
const result = await getAuthCode({
  authorizationUrl: authUrl,
  launch: false,
  timeout: 120000,
});
```

Or use a custom launcher, e.g. to pick a specific browser:

```typescript
import open, { apps } from "open";

const result = await getAuthCode({
  authorizationUrl: authUrl,
  launch: (authorizationUrl) =>
    open(authorizationUrl, { app: { name: apps.firefox } }),
});
```

## Error Handling

### Comprehensive Error Handling

Handle all possible error scenarios:

```typescript
import { getAuthCode, OAuthError, TimeoutError } from "oauth-callback";

try {
  const result = await getAuthCode({ authorizationUrl: authUrl, launch: true });
  // Success - exchange code for token
  return result.code;
} catch (error) {
  if (error instanceof OAuthError) {
    // OAuth-specific errors from provider
    switch (error.error) {
      case "access_denied":
        console.log("User cancelled authorization");
        break;

      case "invalid_scope":
        console.error("Requested scope is invalid:", error.error_description);
        break;

      case "server_error":
        console.error("OAuth server error. Please try again later.");
        break;

      case "temporarily_unavailable":
        console.error("OAuth service is temporarily unavailable");
        break;

      default:
        console.error(`OAuth error: ${error.error}`);
        if (error.error_description) {
          console.error(`Details: ${error.error_description}`);
        }
        if (error.error_uri) {
          console.error(`More info: ${error.error_uri}`);
        }
    }
  } else if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Try a different port.`);
  } else if (error instanceof TimeoutError) {
    console.error("Authorization timed out. Please try again.");
  } else {
    // Unexpected errors
    console.error("Unexpected error:", error);
  }

  throw error; // Re-throw for upstream handling
}
```

## Security Best Practices

### State Parameter Validation

Put a random `state` in the authorization URL. `getAuthCode` reads it from
`authorizationUrl` and validates the callback before it can finish the flow:

```typescript
import { randomBytes } from "crypto";

const state = randomBytes(32).toString("base64url");

const authUrl = new URL("https://oauth.example.com/authorize");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", "http://localhost:3000/callback");
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("scope", "read write");

const result = await getAuthCode({
  authorizationUrl: authUrl.toString(),
  launch: true,
});

console.log("Valid authorization code:", result.code);
```

A callback must contain exactly one non-empty `code` or `error` (not both),
at most one `state`, and, when the authorization URL has `state`, exactly that
value. Other callbacks receive HTTP 400 and are ignored; the listener keeps
waiting until the original timeout. An authorization URL with a duplicate or
empty `state` throws a `TypeError` before the server starts.

### PKCE Implementation

Implement Proof Key for Code Exchange for public clients:

```typescript
import { createHash, randomBytes } from "crypto";

// Generate PKCE challenge
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

// Include challenge in authorization request
const authUrl = new URL("https://oauth.example.com/authorize");
authUrl.searchParams.set("code_challenge", challenge);
authUrl.searchParams.set("code_challenge_method", "S256");
// ... other parameters

const result = await getAuthCode(authUrl.toString());

// Include verifier when exchanging code
const tokenResponse = await fetch("https://oauth.example.com/token", {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code: result.code,
    code_verifier: verifier, // Include PKCE verifier
    client_id: CLIENT_ID,
    redirect_uri: "http://localhost:3000/callback",
  }),
});
```

## Complete Examples

### GitHub OAuth Integration

Full example with error handling and token exchange:

```typescript
import { getAuthCode, OAuthError } from "oauth-callback";

async function authenticateWithGitHub() {
  const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

  // Build authorization URL with all parameters
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", "http://localhost:3000/callback");
  authUrl.searchParams.set("scope", "user:email repo");
  authUrl.searchParams.set("state", crypto.randomUUID());

  try {
    // Get authorization code
    console.log("Opening browser for GitHub authorization...");
    const result = await getAuthCode({
      authorizationUrl: authUrl.toString(),
      launch: true,
      timeout: 60000,
      successHtml: "<h1>✅ GitHub authorization successful!</h1>",
    });

    // Exchange code for access token
    console.log("Exchanging code for access token...");
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: result.code,
        }),
      },
    );

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      throw new Error(`Token exchange failed: ${tokens.error_description}`);
    }

    // Use access token to get user info
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const user = await userResponse.json();
    console.log(`Authenticated as: ${user.login}`);

    return tokens.access_token;
  } catch (error) {
    if (error instanceof OAuthError) {
      console.error("GitHub authorization failed:", error.error_description);
    } else {
      console.error("Authentication error:", error.message);
    }
    throw error;
  }
}
```

### Multi-Provider Support

Handle multiple OAuth providers with a unified interface:

```typescript
type Provider = "github" | "google" | "microsoft";

async function authenticate(provider: Provider): Promise<string> {
  const configs = {
    github: {
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "user:email",
    },
    google: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
    },
    microsoft: {
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scope: "user.read",
    },
  };

  const config = configs[provider];
  const authUrl = new URL(config.authUrl);

  // Add provider-specific parameters
  authUrl.searchParams.set(
    "client_id",
    process.env[`${provider.toUpperCase()}_CLIENT_ID`],
  );
  authUrl.searchParams.set("redirect_uri", "http://localhost:3000/callback");
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", crypto.randomUUID());

  if (provider === "google") {
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
  }

  const result = await getAuthCode({
    authorizationUrl: authUrl.toString(),
    launch: true,
    timeout: 90000,
    onRequest: (req) => {
      console.log(`[${provider}] ${req.method} ${new URL(req.url).pathname}`);
    },
  });

  return result.code;
}
```

## Testing

### Unit Testing

Mock the OAuth flow for testing:

```typescript
import { getAuthCode } from "oauth-callback";
import { describe, it, expect } from "vitest";

describe("OAuth Flow", () => {
  it("should capture authorization code", async () => {
    // Start mock OAuth server
    const mockServer = createMockOAuthServer();
    await mockServer.start();

    const result = await getAuthCode({
      authorizationUrl: `http://localhost:${mockServer.port}/authorize`,
      port: 3001,
      launch: fetch, // Follows the mock redirect to the callback
      timeout: 5000,
    });

    expect(result.code).toBe("test_auth_code");
    expect(result.state).toBe("test_state");

    await mockServer.stop();
  });

  it("should handle OAuth errors", async () => {
    const mockServer = createMockOAuthServer({
      error: "access_denied",
    });
    await mockServer.start();

    await expect(
      getAuthCode({
        authorizationUrl: `http://localhost:${mockServer.port}/authorize`,
        launch: fetch, // Follows the mock redirect to the callback
      }),
    ).rejects.toThrow(OAuthError);

    await mockServer.stop();
  });
});
```

## Migration Guide

### From v2.x to v3.x

The options object now requires both `authorizationUrl` and an explicit
`launch` policy. The string form, `getAuthCode(url)`, is unchanged.

```typescript
// v2.x: server only, URL shown by the caller
await getAuthCode({ port: 3000 });

// v3.x: pass the URL so its `state` is validated
await getAuthCode({ authorizationUrl: url, launch: false, port: 3000 });

// v2.x and v3.x: custom launcher (unchanged)
await getAuthCode({ authorizationUrl: url, launch: open });

// v3.x: system browser without importing `open`
await getAuthCode({ authorizationUrl: url, launch: true });
```

Other changes:

- Callbacks with a mismatched `state`, or with an invalid `code`/`error`
  shape, get HTTP 400 and no longer end the flow; the server keeps waiting.
- An authorization URL with a duplicate or empty `state` throws `TypeError`.
- `browserAuth()` without `launch` opens the system browser (v2.x waited
  without showing the URL).

### From v1.x to v2.x

```typescript
// v1.x (old)
const code = await captureAuthCode(url, 3000);

// v2.x (new)
const result = await getAuthCode({
  authorizationUrl: url,
  launch: open,
  port: 3000,
});
const code = result.code;
```

## Related APIs

- [`OAuthError`](/api/oauth-error) - OAuth-specific error class
- [`browserAuth`](/api/browser-auth) - MCP SDK integration provider
- [`TokenStore`](/api/storage-providers) - Token storage interface
