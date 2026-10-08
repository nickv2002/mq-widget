import test from "node:test";
import assert from "node:assert/strict";
import { parseQueueUrl, tokenUrl, summarize, colorFor, tooltipFor, fetchSummary, QueueError, DEFAULTS } from "./queue.js";

const URL_ = "https://github.com/acme/widgets/queue/main";
const T = { maxCount: 15, maxWaitMinutes: 10 };

test("parseQueueUrl", () => {
  assert.deepEqual(parseQueueUrl(URL_), { owner: "acme", name: "widgets", branch: "main" });
  assert.deepEqual(parseQueueUrl("https://github.com/a/b/queue/release%2F1?x=1"), { owner: "a", name: "b", branch: "release/1" });
  assert.equal(parseQueueUrl("https://github.com/a/b/pulls"), null);
  assert.equal(parseQueueUrl(""), null);
  assert.equal(parseQueueUrl(undefined), null);
});

test("tokenUrl prefills permissions and the org", () => {
  const u = new URL(tokenUrl(URL_));
  assert.equal(u.origin + u.pathname, "https://github.com/settings/personal-access-tokens/new");
  assert.equal(u.searchParams.get("target_name"), "acme");
  for (const p of ["pull_requests", "contents", "metadata"]) assert.equal(u.searchParams.get(p), "read");
  assert.equal(new URL(tokenUrl("")).searchParams.has("target_name"), false);
});

test("empty default URL", async () => {
  assert.equal(DEFAULTS.queueUrl, "");
  await assert.rejects(fetchSummary({ queueUrl: "", token: "x" }), (e) => e.kind === "bad-url" && /Set the merge queue URL/.test(e.message));
});

test("summarize", () => {
  assert.deepEqual(summarize({ entries: { totalCount: 0, nodes: [] } }), { count: 0, waitMinutes: null, unreadable: false });
  assert.deepEqual(
    summarize({ entries: { totalCount: 2, nodes: [{ estimatedTimeToMerge: 300 }, { estimatedTimeToMerge: 600 }] } }),
    { count: 2, waitMinutes: 10, unreadable: false },
  );
  const now = Date.parse("2026-01-01T00:20:00Z");
  assert.deepEqual(
    summarize({ entries: { totalCount: 2, nodes: [{ enqueuedAt: "2026-01-01T00:10:00Z" }, { enqueuedAt: "2026-01-01T00:15:00Z" }] } }, now),
    { count: 2, waitMinutes: 10, unreadable: false },
  );
  // entries a token can't read come back as null nodes
  assert.deepEqual(
    summarize({ entries: { totalCount: 3, nodes: [null, { estimatedTimeToMerge: 120 }, null] } }),
    { count: 3, waitMinutes: 2, unreadable: true },
  );
  assert.deepEqual(summarize({ entries: { totalCount: 2, nodes: [null, null] } }), { count: 2, waitMinutes: null, unreadable: true });
  // totalCount wins over a truncated node list
  assert.equal(summarize({ entries: { totalCount: 150, nodes: [{ estimatedTimeToMerge: 60 }] } }).count, 150);
});

test("colorFor boundaries", () => {
  assert.equal(colorFor({ count: 0, waitMinutes: null, unreadable: false }, T), "green");
  assert.equal(colorFor({ count: 0, waitMinutes: 0 }, T), "green");
  assert.equal(colorFor({ count: 1, waitMinutes: 1 }, T), "blue");
  assert.equal(colorFor({ count: 15, waitMinutes: 10 }, T), "blue");
  assert.equal(colorFor({ count: 16, waitMinutes: 1 }, T), "red");
  assert.equal(colorFor({ count: 3, waitMinutes: 10.01 }, T), "red");
  assert.equal(colorFor({ count: 3, waitMinutes: 11 }, T), "red");
  assert.equal(colorFor({ count: 3, waitMinutes: null }, T), "blue");
});

test("tooltipFor", () => {
  assert.equal(tooltipFor({ count: 3, waitMinutes: 5 }, T), "3 in merge queue, est. wait 5m");
  assert.match(tooltipFor({ count: 20, waitMinutes: 12 }, T), /more than 15 items, wait over 10m/);
  assert.equal(tooltipFor({ count: 1, waitMinutes: null, unreadable: false }, T), "1 in merge queue");
  assert.match(tooltipFor({ count: 2, waitMinutes: null, unreadable: true }, T), /Pull requests: Read/);
});

test("fetchSummary error handling", async () => {
  const ok = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });
  await assert.rejects(fetchSummary({ queueUrl: "nope", token: "x" }), (e) => e.kind === "bad-url");
  await assert.rejects(fetchSummary({ queueUrl: URL_, token: "" }), (e) => e.kind === "no-token");
  await assert.rejects(fetchSummary({ queueUrl: URL_, token: "x" }, ok({}, 401)), (e) => e.kind === "auth");
  await assert.rejects(fetchSummary({ queueUrl: URL_, token: "x" }, ok({}, 500)), (e) => e.kind === "network");
  await assert.rejects(
    fetchSummary({ queueUrl: URL_, token: "x" }, async () => { throw new Error("boom"); }),
    (e) => e instanceof QueueError && e.kind === "network",
  );
  await assert.rejects(
    fetchSummary({ queueUrl: URL_, token: "x" }, ok({ data: { repository: { mergeQueue: null } } })),
    (e) => e.kind === "no-queue",
  );
  const s = await fetchSummary(
    { queueUrl: URL_, token: "x" },
    ok({ data: { repository: { mergeQueue: { entries: { totalCount: 1, nodes: [{ estimatedTimeToMerge: 295 }] } } } } }),
  );
  assert.equal(s.count, 1);
  assert.ok(Math.abs(s.waitMinutes - 295 / 60) < 1e-9);
});
