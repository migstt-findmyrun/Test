# iOFFICE Ticket Assistant (Copilot declarative agent)

A Microsoft 365 Copilot agent that reads an email, picks the matching iOFFICE
service request category, shows you a draft, and creates the ticket after you confirm.

```
Copilot (Outlook / Teams / copilot.microsoft.com)
   │  "Create an iOFFICE ticket from this email"
   ▼
Declarative agent  (appPackage/: instructions + API plugin)
   │  listCategories → AI picks a category → you confirm → createServiceRequest
   ▼
Bridge API  (api/server.js, holds the iOFFICE credentials)
   │  mock mode: sample data      live mode: your iOFFICE REST API
   ▼
iOFFICE
```

## What's in here

| Path | What it is |
|---|---|
| `appPackage/manifest.json` | App manifest that registers the agent in Microsoft 365. |
| `appPackage/declarativeAgent.json` | The agent: name, conversation starters, the Email capability and the plugin. |
| `appPackage/instruction.txt` | The agent's instructions: how it finds the email, picks a category and drafts the ticket. **Edit this to tune behaviour.** |
| `appPackage/ai-plugin.json` | API plugin: the two actions, the confirmation card and the "ticket created" card. |
| `appPackage/apiSpecificationFile/openapi.yaml` | OpenAPI description of the bridge API that Copilot calls. |
| `api/server.js` | The bridge API (Node 22, no dependencies). Mock mode by default. |
| `api/categories.sample.json` | Sample categories for mock mode. Replace with your real categories to test matching. |
| `api/ioffice-live.js` | Live iOFFICE calls. **Placeholders, see "Connecting to the real iOFFICE" below.** |
| `scripts/build-package.js` | Builds the app package zip without the Agents Toolkit. |
| `m365agents.yml`, `env/.env.dev` | Microsoft 365 Agents Toolkit project files. |

## Before you start: check you can test agents

- You need a **Microsoft 365 Copilot licence** (or pay-as-you-go Copilot agents enabled by your admin).
- Your Microsoft 365 admin must allow **uploading custom apps** (sideloading) for you, in the
  Teams admin center under *Teams apps > Setup policies*, or approve the agent in the
  Microsoft 365 admin center under *Integrated apps*.
- Copilot calls your API from Microsoft's cloud, so the bridge API needs a **public HTTPS URL**.
  For testing, use a dev tunnel (below). For production, host it in Azure (App Service or Functions).

## Test it with mock data (no iOFFICE needed)

### 1. Run the bridge API

```bash
npm test      # 5 tests for the API
npm start     # http://localhost:3978 in mock mode
```

Try it: open http://localhost:3978/api/categories in a browser.

### 2. Give it a public HTTPS address

With [Microsoft dev tunnels](https://learn.microsoft.com/azure/developer/dev-tunnels/get-started):

```bash
devtunnel user login
devtunnel host -p 3978 --allow-anonymous
```

Copy the `https://….devtunnels.ms` URL it prints into `OPENAPI_SERVER_URL` in `env/.env.dev`.

> The tunnel is anonymous, so anyone with the URL can call the mock API. That's fine for
> sample data. Don't run live mode through an anonymous tunnel. See "Security" below.

### 3. Install the agent (choose one)

**A. Microsoft 365 Agents Toolkit (recommended).**
Install the *Microsoft 365 Agents Toolkit* extension in VS Code, open this folder, sign in with
your Microsoft 365 account, and choose **Provision** in the toolkit panel. It registers the app,
fills in `TEAMS_APP_ID`, and installs the agent for you.

**B. Upload the package by hand.**

```bash
npm run package   # creates appPackage/build/appPackage.dev.zip
```

In Teams: **Apps > Manage your apps > Upload an app > Upload a custom app** and choose the zip.

### 4. Try it

Open Copilot (in Outlook, Teams or https://m365.cloud.microsoft/chat), pick **iOFFICE Tickets
(dev)** from the agents list, and try:

- *"Show me the iOFFICE service request categories."*
- *"Which category would this go in: the AC on floor 3 is blowing warm air."*
- *"Create an iOFFICE ticket from my most recent email about a facilities problem."*
- With an email open in Outlook: *"Create an iOFFICE ticket from this email."*

You should see a draft, then a **confirmation card**, then a **"ticket created"** card. The
bridge API prints each ticket it "creates" in the terminal.

### What to check while testing

- Does it pick the **right category** for your real emails? Put your real categories (with
  good descriptions) in `api/categories.sample.json`. The descriptions matter most.
- Does it ask you to choose when it's unsure, rather than guessing?
- Does it find **the open email** in Outlook? How well this works depends on where Copilot is
  opened. If it doesn't, it can still search your mailbox (Email capability) or use pasted text.
- Is the drafted subject and description what your service desk wants to see?

Change `appPackage/instruction.txt`, then provision or upload again to apply the change.

## Connecting to the real iOFFICE

1. Get from your iOFFICE admin or Eptura: an **integration user**, how the REST API
   **authenticates**, the endpoint that **lists categories**, the endpoint that **creates a
   service request** with its required fields, and how ticket links look in the iOFFICE UI.
2. Update `api/ioffice-live.js`. Every `TODO` marks a guess to replace: paths, auth headers,
   field names.
3. Set these as environment variables or app settings on the server (never commit them):
   `IOFFICE_MODE=live`, `IOFFICE_BASE_URL`, `IOFFICE_USERNAME`, `IOFFICE_PASSWORD`,
   `IOFFICE_CATEGORIES_PATH`, `IOFFICE_CREATE_PATH`, `IOFFICE_TICKET_URL`.
4. Start it (`npm start`) and test with `curl` before connecting the agent.

## Security (before real use)

The test setup uses `"auth": { "type": "None" }` in `ai-plugin.json`, so the bridge API accepts
calls from anyone who knows its URL. Before connecting it to the real iOFFICE:

- Protect the bridge with **Microsoft Entra ID (OAuth)**, so only signed-in users in your
  organization can call it, and register the OAuth client in the Teams Developer Portal. The
  plugin's `auth` becomes `OAuthPluginVault` with your `reference_id`.
- With Entra ID in place, the bridge knows **who** is asking, so it can set the iOFFICE
  requester from the signed-in user instead of trusting the email address in the request.
- Keep iOFFICE credentials in Azure Key Vault or app settings, not in this repo.
