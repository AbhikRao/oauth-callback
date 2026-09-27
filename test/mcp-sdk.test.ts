/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * browserAuth() against the real MCP SDK on both sides: a real McpServer behind an
 * independent OAuth fixture, so a hand-rolled mock can't hide protocol drift.
 */

import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { browserAuth } from "../src/mcp/index";
import { freePort } from "./helpers";

const timeoutMs = 15_000;

test(
  "browserAuth completes a real MCP SDK OAuth flow against a local fixture",
  async () => {
    const calls: string[] = [];
    let origin = "";
    let mcpUrl = "";
    let resourceMetadataUrl = "";
    let authorizationChallenge: string | undefined;
    let redirectUri: string | undefined;
    const mcp = new McpServer({
      name: "local-oauth-fixture",
      version: "1.0.0",
    });
    const mcpTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
    });
    let server: ReturnType<typeof Bun.serve> | undefined;
    const client = new Client(
      { name: "oauth-callback-integration-test", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      mcp.registerTool("fixture_status", {}, async () => ({
        content: [{ type: "text", text: "authenticated" }],
      }));
      await mcp.connect(mcpTransport);

      server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url);
          calls.push(`${request.method} ${url.pathname}`);

          if (url.pathname === "/.well-known/oauth-protected-resource") {
            return Response.json({
              resource: mcpUrl,
              authorization_servers: [origin],
            });
          }
          if (url.pathname === "/.well-known/oauth-authorization-server") {
            return Response.json({
              issuer: origin,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              registration_endpoint: `${origin}/register`,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
            });
          }
          if (url.pathname === "/register" && request.method === "POST") {
            const registration = (await request.json()) as {
              redirect_uris?: string[];
            };
            return Response.json({
              client_id: "fixture-client",
              redirect_uris: registration.redirect_uris,
              grant_types: ["authorization_code"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            });
          }
          if (url.pathname === "/authorize") {
            const callbackUri = url.searchParams.get("redirect_uri");
            const state = url.searchParams.get("state");
            const challenge = url.searchParams.get("code_challenge");
            if (
              !callbackUri ||
              !state ||
              !challenge ||
              url.searchParams.get("code_challenge_method") !== "S256"
            ) {
              return new Response("Invalid authorization request", {
                status: 400,
              });
            }
            authorizationChallenge = challenge;
            redirectUri = callbackUri;
            const callback = new URL(callbackUri);
            callback.searchParams.set("code", "fixture-code");
            callback.searchParams.set("state", state);
            return Response.redirect(callback.href, 302);
          }
          if (url.pathname === "/token" && request.method === "POST") {
            const form = new URLSearchParams(await request.text());
            const verifier = form.get("code_verifier");
            const expectedChallenge = authorizationChallenge;
            if (
              form.get("grant_type") !== "authorization_code" ||
              form.get("code") !== "fixture-code" ||
              form.get("client_id") !== "fixture-client" ||
              form.get("redirect_uri") !== redirectUri ||
              !verifier ||
              !expectedChallenge ||
              createHash("sha256").update(verifier).digest("base64url") !==
                expectedChallenge
            ) {
              return Response.json({ error: "invalid_grant" }, { status: 400 });
            }
            return Response.json({
              access_token: "fixture-access-token",
              token_type: "Bearer",
              expires_in: 3600,
            });
          }
          if (url.pathname === "/mcp") {
            if (
              request.headers.get("authorization") !==
              "Bearer fixture-access-token"
            ) {
              return new Response(null, {
                status: 401,
                headers: {
                  "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
                },
              });
            }
            return mcpTransport.handleRequest(request);
          }
          return new Response("Not found", { status: 404 });
        },
      });
      origin = server.url.origin;
      mcpUrl = `${origin}/mcp`;
      resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource`;

      const provider = browserAuth({
        serverUrl: mcpUrl,
        redirectUri: `http://127.0.0.1:${await freePort()}/callback`,
        clientName: "oauth-callback-integration-test",
        timeout: timeoutMs,
        launch: async (authorizationUrl) => {
          expect(new URL(authorizationUrl).origin).toBe(origin);
          const response = await fetch(authorizationUrl);
          expect(response.ok).toBe(true);
          await response.body?.cancel();
        },
      });

      const createTransport = () =>
        new StreamableHTTPClientTransport(new URL(mcpUrl), {
          authProvider: provider,
        });

      // Caller-owned transport: UnauthorizedError, then completeAuthorization() and a fresh transport.
      const initial = createTransport();
      await expect(client.connect(initial)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      await provider.completeAuthorization(initial);
      await initial.close();
      expect(await provider.tokens()).toMatchObject({
        access_token: "fixture-access-token",
      });

      await client.connect(createTransport());
      const result = await client.callTool({ name: "fixture_status" });

      expect(result).toMatchObject({
        content: [{ type: "text", text: "authenticated" }],
      });
      expect(calls.some((call) => call.endsWith(" /register"))).toBe(true);
      expect(calls.some((call) => call.endsWith(" /authorize"))).toBe(true);
      expect(calls.some((call) => call.endsWith(" /token"))).toBe(true);
      expect(calls.some((call) => call.endsWith(" /mcp"))).toBe(true);
      expect(authorizationChallenge).toBeDefined();
    } finally {
      await client.close().catch(() => undefined);
      await mcp.close().catch(() => undefined);
      server?.stop(true);
    }
  },
  timeoutMs,
);
