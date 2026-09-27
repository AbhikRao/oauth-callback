/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * browserAuth() against the real MCP SDK on both sides. The resource server (metadata,
 * 401 challenge, MCP transport) is the SDK's own, so protocol drift between SDK client and
 * server can't hide behind test/mock-mcp-server.ts; only the authorization server is a fixture.
 */

import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import {
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  oauthMetadataResponse,
  requireBearerAuth,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { browserAuth } from "../src/mcp/index";
import { freePort } from "./helpers";

let fixture: Awaited<ReturnType<typeof startFixture>>;
const clients: Client[] = [];

beforeEach(async () => (fixture = await startFixture()));

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
  await fixture.close();
});

const newClient = () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  clients.push(client);
  return client;
};

/** Provider whose "browser" follows the authorization redirect back to the loopback listener. */
const setup = async () =>
  browserAuth({
    serverUrl: fixture.mcpUrl,
    redirectUri: `http://127.0.0.1:${await freePort()}/callback`,
    clientName: "oauth-callback-test",
    launch: async (url) => void (await fetch(url)).body?.cancel(),
    timeout: 5000,
  });

/** The tool echoes the client the SDK's bearer check verified. */
const expectAuthorized = async (client: Client) =>
  expect(await client.callTool({ name: "whoami" })).toMatchObject({
    content: [{ type: "text", text: "fixture-client" }],
  });

test("connect() authorizes on the 401 and reconnects in one call", async () => {
  const client = newClient();
  await (await setup()).connect(client);
  await expectAuthorized(client);
});

test("your own transport: complete the flow, then retry on a fresh transport", async () => {
  const auth = await setup();
  const transport = () =>
    new StreamableHTTPClientTransport(fixture.mcpUrl, { authProvider: auth });
  const client = newClient();
  const first = transport();
  await expect(client.connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
  await auth.completeAuthorization(first);
  await first.close();
  await client.connect(transport());
  await expectAuthorized(client);
});

/** SDK resource server + a minimal authorization server (DCR, S256 PKCE) on one origin. */
async function startFixture() {
  const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
  mcp.registerTool("whoami", {}, async (ctx) => ({
    content: [{ type: "text", text: ctx.http?.authInfo?.clientId ?? "" }],
  }));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
  });
  await mcp.connect(transport);

  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const tokens = new Set<string>();
  let origin = "";
  let requireAuth: ReturnType<typeof requireBearerAuth>;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const metadata = oauthMetadataResponse(request, {
        resourceServerUrl: new URL("/mcp", origin),
        oauthMetadata: {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
        dangerouslyAllowInsecureIssuerUrl: true,
      });
      if (metadata) return metadata;

      if (url.pathname === "/mcp") {
        const auth = await requireAuth(request);
        if (auth instanceof Response) return auth;
        return transport.handleRequest(request, { authInfo: auth });
      }
      if (url.pathname === "/register" && request.method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        return Response.json({ ...body, client_id: "fixture-client" }, 201);
      }
      if (url.pathname === "/authorize") {
        // Plays the user approving: redirect back with a code bound to the PKCE challenge.
        const params = url.searchParams;
        if (params.get("code_challenge_method") !== "S256")
          return new Response("S256 required", { status: 400 });
        const code = randomUUID();
        codes.set(code, {
          challenge: params.get("code_challenge")!,
          redirectUri: params.get("redirect_uri")!,
        });
        const callback = new URL(params.get("redirect_uri")!);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", params.get("state")!);
        return Response.redirect(callback.href, 302);
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const form = new URLSearchParams(await request.text());
        const grant = codes.get(form.get("code") ?? "");
        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          !grant ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("client_id") !== "fixture-client" ||
          form.get("redirect_uri") !== grant.redirectUri ||
          challenge !== grant.challenge
        )
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        codes.delete(form.get("code")!);
        const token = randomUUID();
        tokens.add(token);
        return Response.json({
          access_token: token,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  origin = server.url.origin;
  const mcpUrl = new URL("/mcp", origin);
  requireAuth = requireBearerAuth({
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
    verifier: {
      async verifyAccessToken(token) {
        if (!tokens.has(token))
          throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown token");
        return {
          token,
          clientId: "fixture-client",
          scopes: [],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        };
      },
    },
  });

  return {
    mcpUrl,
    async close() {
      await mcp.close().catch(() => {});
      await server.stop(true);
    },
  };
}
