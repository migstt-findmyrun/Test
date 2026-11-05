// iOFFICE Ticket Bridge
//
// The Copilot agent calls this API (see appPackage/apiSpecificationFile/openapi.yaml).
// It keeps the iOFFICE credentials on the server so they are never in the agent package.
//
//   IOFFICE_MODE=mock  (default) sample categories, tickets kept in memory
//   IOFFICE_MODE=live  calls your iOFFICE REST API (fill in ioffice-live.js first)
//
// No dependencies: run with `node api/server.js`.

const http = require("node:http");
const { URL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

const PORT = Number(process.env.PORT || 3978);
const MODE = (process.env.IOFFICE_MODE || "mock").toLowerCase();
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const MAX_BODY_BYTES = 100 * 1024;

function createMockBackend() {
  const categories = JSON.parse(
    fs.readFileSync(path.join(__dirname, "categories.sample.json"), "utf8")
  );
  const tickets = [];
  let next = 10001;
  return {
    async listCategories() {
      return categories;
    },
    async createTicket(t) {
      const category = categories.find((c) => c.id === t.categoryId);
      const ticket = {
        id: String(next),
        ticketNumber: `SR-${next}`,
        categoryId: t.categoryId,
        categoryName: category ? category.path : t.categoryId,
        subject: t.subject,
        priority: t.priority,
        status: "New",
        url: `https://example.iofficeconnect.com/mock/requests/${next}`,
      };
      next += 1;
      tickets.push({ ...ticket, ...t, createdAt: new Date().toISOString() });
      console.log(`[mock] created ${ticket.ticketNumber} in "${ticket.categoryName}": ${t.subject}`);
      return ticket;
    },
    tickets,
  };
}

function createBackend() {
  if (MODE === "live") return require("./ioffice-live.js").createLiveBackend();
  if (MODE !== "mock") throw new Error(`Unknown IOFFICE_MODE "${MODE}" (use mock or live)`);
  return createMockBackend();
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("Body is not valid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function validateTicket(body, categories) {
  const errors = [];
  for (const field of ["categoryId", "subject", "description", "requesterEmail"]) {
    if (typeof body[field] !== "string" || !body[field].trim()) errors.push(`${field} is required`);
  }
  if (body.categoryId && !categories.some((c) => c.id === String(body.categoryId))) {
    errors.push(`categoryId "${body.categoryId}" is not a known category; call listCategories first`);
  }
  const priority = body.priority || "Normal";
  if (!PRIORITIES.includes(priority)) errors.push(`priority must be one of ${PRIORITIES.join(", ")}`);
  if (errors.length) return { errors };
  return {
    ticket: {
      categoryId: String(body.categoryId),
      subject: body.subject.trim().slice(0, 80),
      description: body.description.trim(),
      requesterEmail: body.requesterEmail.trim(),
      location: body.location ? String(body.location).trim() : undefined,
      priority,
      sourceEmailSubject: body.sourceEmailSubject ? String(body.sourceEmailSubject).trim() : undefined,
    },
  };
}

function createServer(backend = createBackend()) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    console.log(`${req.method} ${url.pathname}${url.search}`);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true, mode: MODE });
      }
      if (req.method === "GET" && url.pathname === "/api/categories") {
        let categories = await backend.listCategories();
        const search = (url.searchParams.get("search") || "").trim().toLowerCase();
        if (search) {
          const words = search.split(/\s+/);
          const filtered = categories.filter((c) => {
            const text = `${c.path} ${c.description}`.toLowerCase();
            return words.some((w) => text.includes(w));
          });
          // Never return an empty list: the agent should still see every option.
          if (filtered.length) categories = filtered;
        }
        return sendJson(res, 200, { categories });
      }
      if (req.method === "POST" && url.pathname === "/api/tickets") {
        const body = await readJson(req);
        const { errors, ticket } = validateTicket(body, await backend.listCategories());
        if (errors) return sendJson(res, 400, { error: errors.join("; ") });
        return sendJson(res, 201, await backend.createTicket(ticket));
      }
      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      console.error(err);
      return sendJson(res, err.status || 502, { error: err.status ? err.message : "iOFFICE request failed" });
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`iOFFICE Ticket Bridge (${MODE} mode) listening on http://localhost:${PORT}`);
  });
}

module.exports = { createServer, createMockBackend, validateTicket };
