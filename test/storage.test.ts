/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenStore, Tokens } from "../src/mcp-types";
import { fileStore } from "../src/storage/file";
import { inMemoryStore } from "../src/storage/memory";

const primaryTokens: Tokens = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: 2_000_000_000_000,
  scope: "read write",
};

const replacementTokens: Tokens = {
  accessToken: "replacement-access-token",
  refreshToken: "replacement-refresh-token",
  expiresAt: 2_100_000_000_000,
  scope: "admin",
};

describe("inMemoryStore", () => {
  let store: TokenStore;

  beforeEach(() => {
    store = inMemoryStore();
  });

  test("returns null for a missing key", async () => {
    expect(await store.get("missing")).toBeNull();
  });

  test("stores and retrieves tokens", async () => {
    await store.set("account", primaryTokens);

    expect(await store.get("account")).toEqual(primaryTokens);
  });

  test("overwrites an existing key", async () => {
    await store.set("account", primaryTokens);
    await store.set("account", replacementTokens);

    expect(await store.get("account")).toEqual(replacementTokens);
  });

  test("isolates keys and deletes only the requested key", async () => {
    await store.set("first", primaryTokens);
    await store.set("second", replacementTokens);

    await store.delete("first");

    expect(await store.get("first")).toBeNull();
    expect(await store.get("second")).toEqual(replacementTokens);
  });
});

describe("fileStore", () => {
  let tempDir: string;
  let filepath: string;
  let store: TokenStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "oauth-callback-storage-"));
    filepath = join(tempDir, "nested", "tokens.json");
    store = fileStore(filepath);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns null when the storage file does not exist", async () => {
    expect(await store.get("missing")).toBeNull();
  });

  test("creates parent directories and persists tokens", async () => {
    await store.set("account", primaryTokens);

    const reopenedStore = fileStore(filepath);
    expect(await reopenedStore.get("account")).toEqual(primaryTokens);

    const persisted = JSON.parse(await readFile(filepath, "utf-8"));
    expect(persisted.account).toEqual(primaryTokens);
  });

  test("overwrites one key without changing another", async () => {
    await store.set("first", primaryTokens);
    await store.set("second", replacementTokens);

    await store.set("first", replacementTokens);

    expect(await store.get("first")).toEqual(replacementTokens);
    expect(await store.get("second")).toEqual(replacementTokens);
  });

  test("deletes only the requested key", async () => {
    await store.set("first", primaryTokens);
    await store.set("second", replacementTokens);

    await store.delete("first");

    expect(await store.get("first")).toBeNull();
    expect(await store.get("second")).toEqual(replacementTokens);

    const persisted = JSON.parse(await readFile(filepath, "utf-8"));
    expect(persisted.first).toBeUndefined();
    expect(persisted.second).toEqual(replacementTokens);
  });

  test("recovers from invalid JSON on the next write", async () => {
    await store.set("old", primaryTokens);
    await writeFile(filepath, "{invalid-json", "utf-8");

    expect(await store.get("old")).toBeNull();

    await store.set("recovered", replacementTokens);

    expect(await store.get("recovered")).toEqual(replacementTokens);
    const persisted = JSON.parse(await readFile(filepath, "utf-8"));
    expect(persisted).toEqual({ recovered: replacementTokens });
  });

  test("round-trips Unicode keys and token values", async () => {
    const unicodeTokens: Tokens = {
      accessToken: "令牌-🔐",
      refreshToken: "更新-♻️",
      scope: "读取 写入 🚀",
    };

    await store.set("用户-🔑", unicodeTokens);

    expect(await store.get("用户-🔑")).toEqual(unicodeTokens);
  });
});
