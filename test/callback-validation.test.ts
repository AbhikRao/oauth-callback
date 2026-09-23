/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test";
import { getAuthCode, OAuthError, TimeoutError } from "../src/index";

const callbackUrl = (port: number, query = "") =>
  `http://localhost:${port}/callback${query ? `?${query}` : ""}`;

describe("callback validation", () => {
  test("ignores invalid callbacks until a valid callback arrives", async () => {
    const port = 3010;
    const statuses: number[] = [];
    let launchWork: Promise<void> | undefined;

    const resultPromise = getAuthCode({
      authorizationUrl: "https://example.com/authorize",
      port,
      expectedState: "expected-state",
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

    expect(statuses.slice(0, -1)).toEqual([
      400, 400, 400, 400, 400, 400, 400,
    ]);
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
        authorizationUrl: "https://example.com/authorize",
        port,
        expectedState: "expected-state",
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

    const result = getAuthCode({
      authorizationUrl: "https://example.com/authorize",
      port,
      expectedState: "expected-state",
      timeout: 250,
      launch: () => {
        launchWork = (async () => {
          const response = await fetch(
            callbackUrl(port, "code=abc&state=wrong-state"),
          );
          callbackStatus = response.status;
        })();

        return launchWork;
      },
    });

    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    await launchWork;
    expect(callbackStatus).toBe(400);
  });

  test("abort still works while invalid callbacks keep arriving", async () => {
    const port = 3013;
    const controller = new AbortController();
    const statuses: number[] = [];
    let launchWork: Promise<void> | undefined;
    let caught: unknown;

    try {
      await getAuthCode({
        authorizationUrl: "https://example.com/authorize",
        port,
        expectedState: "expected-state",
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
});
