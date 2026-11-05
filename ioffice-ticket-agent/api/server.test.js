// Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { createServer, createMockBackend } = require("./server.js");

async function withServer(fn) {
  const server = createServer(createMockBackend());
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test("lists categories", () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/api/categories`);
    assert.strictEqual(res.status, 200);
    const { categories } = await res.json();
    assert.ok(categories.length > 5);
    assert.ok(categories.every((c) => c.id && c.name && c.path));
  }));

test("search narrows categories but never returns an empty list", () =>
  withServer(async (base) => {
    const hvac = await (await fetch(`${base}/api/categories?search=thermostat`)).json();
    assert.deepStrictEqual(hvac.categories.map((c) => c.id), ["101"]);
    const none = await (await fetch(`${base}/api/categories?search=zzzz`)).json();
    assert.ok(none.categories.length > 5);
  }));

test("creates a ticket", () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/api/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: "101",
        subject: "Warm air from AC – Floor 3",
        description: "AC is blowing warm air.",
        requesterEmail: "someone@example.com",
        priority: "High",
      }),
    });
    assert.strictEqual(res.status, 201);
    const ticket = await res.json();
    assert.match(ticket.ticketNumber, /^SR-\d+$/);
    assert.strictEqual(ticket.categoryName, "Facilities > HVAC");
    assert.strictEqual(ticket.priority, "High");
  }));

test("rejects unknown category and missing fields", () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/api/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: "999", subject: "x" }),
    });
    assert.strictEqual(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /not a known category/);
    assert.match(error, /description is required/);
  }));

test("rejects invalid JSON", () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/api/tickets`, { method: "POST", body: "{nope" });
    assert.strictEqual(res.status, 400);
  }));
