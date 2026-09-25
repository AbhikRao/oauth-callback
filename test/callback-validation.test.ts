/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, mock, test } from "bun:test";
import { getAuthCode, OAuthError, TimeoutError } from "../src/index";

const authorizationUrl = "https://example.com/authorize?state=expected-state";

const callbackUrl = (port: number, query = "") =>
  `http://localhost:${port}/callback${query ? `?${query}` : ""}`;

describe("callback validation", () => {
  test("ignores invalid callbacks until a valid callback arrives", async () => {
    const port = 3010;
    const statuses: number[] = [];
    let launchWork: Promise<void> | undefined;

    const resultPromise = getAuthCode({
      authorizationUrl,
      port,
      timeout: 2000,
      launch: () => {
        launchWork = (async () => {
          const invalidCallbacks = [
            "code=abc&error=access_denied&state=expected-state",
            "code=&state=expected-state",
            "code=first&code=second&state=expected-state",
            "error=first&error=second&state=expected-state",
            "code=abc&state=expected-state&state=expected-state",
            "code=abc",
            "",
          ];

          for (const query of invalidCallbacks) {
            const response = await fetch(callbackUrl(port, query));
            statuses.push(response.status);
          }

          const valid = await fetch(
            callbackUrl(
              port,
              "code=valid-code&state=expected-state&scope=read&provider=example",
            ),
          );
          statuses.push(valid.status);
        })();

        return launchWork;
      },
    });

    const result = await resultPromise;
    await launchWork;

    const invalidStatuses = statuses.slice(0, -1);
    expect(invalidStatuses).toEqual([400, 400, 400, 400, 400, 400, 400]);
    expect(statuses.at(-1)).toBe(200);
    expect(result.code).toBe("valid-code");
    expect(result.state).toBe("expected-state");
    expect(result.scope).toBe("read");
    expect(result.provider).toBe("example");
  });

  test("accepts a provider error with matching state", async () => {
    const port = 3011;
    let callbackStatus: number | undefined;
    let launchWork: Promise<void> | undefined;
    let caught: unknown;

    try {
      await getAuthCode({
        authorizationUrl,
        port,
        timeout: 2000,
        launch: () => {
          launchWork = (async () => {
            const response = await fetch(
              callbackUrl(
                port,
                "error=access_denied&error_description=Denied&state=expected-state",
              ),
            );
            callbackStatus = response.status;
          })();

          return launchWork;
        },
      });
    } catch (error) {
      caught = error;
    }

    await launchWork;

    expect(caught).toBeInstanceOf(OAuthError);
    expect((caught as OAuthError).error).toBe("access_denied");
    expect((caught as OAuthError).error_description).toBe("Denied");
    expect(callbackStatus).toBe(200);
  });

  test("keeps waiting after mismatched state and times out", async () => {
    const port = 3012;
    let callbackStatus: number | undefined;
    let launchWork: Promise<void> | undefined;

    let callbackBody: string | undefined;

    const result = getAuthCode({
      authorizationUrl,
      port,
      timeout: 250,
      launch: () => {
        launchWork = (async () => {
          const response = await fetch(
            callbackUrl(port, "code=abc&state=wrong-state"),
          );
          callbackStatus = response.status;
          callbackBody = await response.text();
        })();

        return launchWork;
      },
    });

    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    await launchWork;
    expect(callbackStatus).toBe(400);
    // Neutral text, not the "Authorization Failed" page: the flow is still active.
    expect(callbackBody).toContain("does not match the active authorization");
  });

  test("validates state with manual launch", async () => {
    const port = 3014;

    const result = getAuthCode({
      authorizationUrl,
      launch: false,
      port,
      timeout: 2000,
    });
    const mismatched = await fetch(callbackUrl(port, "code=abc&state=wrong"));
    const matched = await fetch(
      callbackUrl(port, "code=valid-code&state=expected-state"),
    );

    expect(mismatched.status).toBe(400);
    expect(matched.status).toBe(200);
    expect((await result).code).toBe("valid-code");
  });

  test("rejects duplicate callback state when authorization URL has no state", async () => {
    const port = 3015;

    const result = getAuthCode({
      authorizationUrl: "https://example.com/authorize",
      launch: false,
      port,
      timeout: 2000,
    });
    const duplicate = await fetch(
      callbackUrl(port, "code=abc&state=one&state=two"),
    );
    const valid = await fetch(callbackUrl(port, "code=valid-code&state=one"));

    expect(duplicate.status).toBe(400);
    expect(valid.status).toBe(200);
    expect((await result).code).toBe("valid-code");
  });

  test("abort still works while invalid callbacks keep arriving", async () => {
    const port = 3013;
    const controller = new AbortController();
    const statuses: number[] = [];
    let launchWork: Promise<void> | undefined;
    let caught: unknown;

    try {
      await getAuthCode({
        authorizationUrl,
        port,
        timeout: 2000,
        signal: controller.signal,
        launch: () => {
          launchWork = (async () => {
            for (let index = 0; index < 3; index++) {
              const response = await fetch(
                callbackUrl(port, `code=abc&state=wrong-${index}`),
              );
              statuses.push(response.status);
            }
            controller.abort();
          })();

          return launchWork;
        },
      });
    } catch (error) {
      caught = error;
    }

    await launchWork;

    expect(statuses).toEqual([400, 400, 400]);
    expect(caught).toBeInstanceOf(Error);
    expect(
      ["Operation aborted", "Server stopped before callback received"].includes(
        (caught as Error).message,
      ),
    ).toBe(true);
  });

  test.each([
    ["duplicate", "state=one&state=two"],
    ["empty", "state="],
  ])("rejects %s state in authorizationUrl before launch", async (_, query) => {
    let launched = false;
    const result = getAuthCode({
      authorizationUrl: `https://example.com/authorize?${query}`,
      launch: () => {
        launched = true;
      },
      port: 3016,
    });

    await expect(result).rejects.toBeInstanceOf(TypeError);
    expect(launched).toBe(false);
  });

  test("swallows a synchronous launcher throw", async () => {
    const port = 3017;

    const result = getAuthCode({
      authorizationUrl,
      launch: () => {
        throw new Error("cannot open browser");
      },
      port,
      timeout: 2000,
    });
    const response = await fetch(
      callbackUrl(port, "code=valid-code&state=expected-state"),
    );

    expect(response.status).toBe(200);
    expect((await result).code).toBe("valid-code");
  });

  test("string overload validates state from the URL", async () => {
    const port = 3000; // String overload uses the default port
    const statuses: number[] = [];
    let launchWork: Promise<void> | undefined;

    // Stand-in browser: a stale callback first, then the real one.
    // Module mocks are process-sticky; no later test relies on the real `open`.
    mock.module("open", () => ({
      default: () => {
        launchWork = (async () => {
          for (const state of ["wrong-state", "expected-state"]) {
            const response = await fetch(
              callbackUrl(port, `code=code-${state}&state=${state}`),
            );
            statuses.push(response.status);
          }
        })();
      },
    }));

    const result = await getAuthCode(authorizationUrl);
    await launchWork;

    expect(statuses).toEqual([400, 200]);
    expect(result.code).toBe("code-expected-state");
  });

  test("abort right after the call rejects promptly", async () => {
    const controller = new AbortController();
    const result = getAuthCode({
      authorizationUrl,
      launch: false,
      port: 3018,
      timeout: 5000,
      signal: controller.signal,
    });
    controller.abort();

    // Not TimeoutError: the flow must not wait on a server stopped mid-start.
    await expect(result).rejects.toThrow("Operation aborted");
  });
});
