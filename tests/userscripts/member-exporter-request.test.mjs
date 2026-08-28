import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../../userscripts/member-candidate-loadout-exporter.user.js", import.meta.url), "utf8");

function loadTransport(overrides = {}) {
  const start = source.indexOf("function gmXmlHttpRequestFn()");
  const end = source.indexOf("\n  const COMBAT_ABILITY_NAMES_ZH");
  assert.ok(start >= 0 && end > start);
  const sandbox = {
    GM_xmlhttpRequest: overrides.GM_xmlhttpRequest,
    GM: overrides.GM,
    fetch: overrides.fetch,
    AbortController,
    setTimeout,
    clearTimeout,
    tr(key) {
      if (key === "syncUnreachable") return "无法连接公会资料服务";
      if (key === "syncTimeout") return "同步超时";
      return key;
    },
  };
  runInNewContext(source.slice(start, end), sandbox);
  return sandbox;
}

test("requestJson uses page fetch when GM_xmlhttpRequest is unavailable", async () => {
  const calls = [];
  const transport = loadTransport({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, text: async () => JSON.stringify({ eligible: true }) };
    },
  });
  const response = await transport.requestJson({
    method: "GET",
    url: "https://adudu.tailab136f.ts.net/api/public/guilds/TMD/members/adudu/eligibility",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.mode, "cors");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(Object.keys(calls[0].options.headers).length, 0);
  assert.equal(calls[0].options.body, undefined);
  assert.equal(response.status, 200);
  assert.match(response.responseText, /eligible/);
});

test("requestJson falls back to fetch after GM XHR onerror, matching iOS Focus CORS failure", async () => {
  const fetchCalls = [];
  const transport = loadTransport({
    GM_xmlhttpRequest(details) {
      assert.equal(details.fetch, false);
      details.onerror();
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return { status: 200, text: async () => "{\"ok\":true}" };
    },
  });
  const response = await transport.requestJson({
    method: "POST",
    url: "https://adudu.tailab136f.ts.net/api/public/guilds/TMD/roster",
    data: { members: [] },
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].options.headers["content-type"], "application/json");
  assert.equal(fetchCalls[0].options.body, JSON.stringify({ members: [] }));
  assert.equal(response.status, 200);
  assert.equal(response.responseText, "{\"ok\":true}");
});

test("requestJson prefers GM.xmlHttpRequest when the legacy GM_xmlhttpRequest grant is missing", async () => {
  let usedModern = false;
  const transport = loadTransport({
    GM: {
      xmlHttpRequest(details) {
        usedModern = true;
        details.onload({ status: 204, responseText: "" });
      },
    },
    fetch() {
      throw new Error("fetch should not run when GM.xmlHttpRequest succeeds");
    },
  });
  const response = await transport.requestJson({
    method: "GET",
    url: "https://raw.githubusercontent.com/example/latest.json",
  });
  assert.equal(usedModern, true);
  assert.equal(response.status, 204);
});

test("requestJson maps a failed fetch to the same unreachable message members already see", async () => {
  const transport = loadTransport({
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await assert.rejects(
    () => transport.requestJson({ method: "GET", url: "https://adudu.tailab136f.ts.net/health" }),
    { message: "无法连接公会资料服务" },
  );
});
