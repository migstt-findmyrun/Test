// Live iOFFICE backend: used when IOFFICE_MODE=live.
//
// The iOFFICE REST API reference for your instance was not available when this was
// written, so the paths, auth headers and field names below are PLACEHOLDERS.
// Check each "TODO" against your iOFFICE REST API documentation before using it.
//
// Settings (environment variables, never commit real values):
//   IOFFICE_BASE_URL         e.g. https://yourorg.iofficeconnect.com/external/api/rest/v2
//   IOFFICE_USERNAME         integration user
//   IOFFICE_PASSWORD         integration user's password
//   IOFFICE_CATEGORIES_PATH  path that lists service request categories (TODO: confirm)
//   IOFFICE_CREATE_PATH      path that creates a service request (TODO: confirm)
//   IOFFICE_TICKET_URL       link template for the UI, e.g. https://yourorg.iofficeconnect.com/...{id}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function createLiveBackend() {
  const baseUrl = required("IOFFICE_BASE_URL").replace(/\/$/, "");
  const username = required("IOFFICE_USERNAME");
  const password = required("IOFFICE_PASSWORD");
  const categoriesPath = process.env.IOFFICE_CATEGORIES_PATH || "/services/categories"; // TODO: confirm
  const createPath = process.env.IOFFICE_CREATE_PATH || "/services/requests"; // TODO: confirm
  const ticketUrlTemplate = process.env.IOFFICE_TICKET_URL || "";

  // TODO: confirm how your instance authenticates. iOFFICE integrations commonly send
  // the integration user's credentials in headers like these; yours may use a token.
  const authHeaders = {
    "x-auth-username": username,
    "x-auth-password": password,
  };

  async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...authHeaders, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`iOFFICE ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  }

  let cache = { at: 0, categories: [] };
  const CACHE_MS = 10 * 60 * 1000;

  return {
    async listCategories() {
      if (Date.now() - cache.at < CACHE_MS && cache.categories.length) return cache.categories;
      const raw = await call("GET", categoriesPath);
      const list = Array.isArray(raw) ? raw : raw.categories || raw.data || [];
      // TODO: map iOFFICE's field names onto { id, name, path, description }.
      const categories = list.map((c) => ({
        id: String(c.id),
        name: c.name,
        path: c.path || (c.parent && c.parent.name ? `${c.parent.name} > ${c.name}` : c.name),
        description: c.description || "",
      }));
      cache = { at: Date.now(), categories };
      return categories;
    },

    async createTicket(t) {
      // TODO: map onto the fields your create-service-request endpoint expects.
      const payload = {
        category: { id: t.categoryId },
        subject: t.subject,
        description: t.sourceEmailSubject
          ? `${t.description}\n\nOriginal email subject: ${t.sourceEmailSubject}`
          : t.description,
        requester: { email: t.requesterEmail },
        location: t.location,
        priority: t.priority,
      };
      const created = await call("POST", createPath, payload);
      const categories = await this.listCategories();
      const category = categories.find((c) => c.id === t.categoryId);
      const id = String(created.id);
      return {
        id,
        ticketNumber: String(created.number || created.ticketNumber || id), // TODO: confirm
        categoryId: t.categoryId,
        categoryName: category ? category.path : t.categoryId,
        subject: t.subject,
        priority: t.priority,
        status: created.status && created.status.name ? created.status.name : String(created.status || "New"),
        url: ticketUrlTemplate ? ticketUrlTemplate.replace("{id}", encodeURIComponent(id)) : "",
      };
    },
  };
}

module.exports = { createLiveBackend };
