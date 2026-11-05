# iOFFICE Ticket Assistant (Copilot declarative agent)

A Microsoft 365 Copilot agent that reads an email, picks the matching iOFFICE
service request category, shows you a draft, and creates the ticket after you confirm.

**Self-contained: no server to host.** Copilot calls the iOFFICE REST API directly.
The iOFFICE secret is kept in Microsoft 365's API key vault, not in this repo or the package.

```
Copilot (Outlook / Teams / Microsoft 365 Copilot app)
   │  "Create an iOFFICE ticket from this email"
   ▼
Declarative agent  (appPackage/: instructions + API plugin)
   │  listCategories → AI picks a category → you confirm → createServiceRequest
   │  (Copilot adds the iOFFICE secret from the Microsoft 365 API key vault)
   ▼
iOFFICE REST API  (https://yourorg.iofficeconnect.com/...)
```

## What's in here

| Path | What it is |
|---|---|
| `appPackage/manifest.json` | App manifest that registers the agent in Microsoft 365. |
| `appPackage/declarativeAgent.json` | The agent: name, conversation starters, the Email capability and the plugin. |
| `appPackage/instruction.txt` | The agent's instructions: how it finds the email, picks a category and drafts the ticket. **Edit this to tune behaviour.** |
| `appPackage/ai-plugin.json` | API plugin: the two actions, the confirmation card, the "ticket created" card, and the API key vault reference. |
| `appPackage/apiSpecificationFile/openapi.yaml` | Description of the iOFFICE endpoints the agent calls. **Contains placeholders (`TODO`).** |
| `env/.env.dev` | Settings for your instance (non-secret). |
| `m365agents.yml` | Microsoft 365 Agents Toolkit project file: registers the key and installs the agent. |
| `scripts/build-package.js` | Builds the app package zip without the toolkit. |
| `scripts/package.test.js` | Checks the package files agree with each other (`npm test`). |

## Step 1: Get the details from your iOFFICE admin

The iOFFICE API reference isn't public, so `openapi.yaml` contains educated guesses. Ask for:

1. **The REST API base address**, e.g. `https://yourorg.iofficeconnect.com/external/api/rest/v2`.
2. **How it authenticates.** This decides whether the no-server setup works:
   - **A single API token in a header** works well. Put the header name in
     `IOFFICE_AUTH_HEADER` and remove the `AuthUsername` parameter from `openapi.yaml`.
   - **Username and password in two headers** (e.g. `x-auth-username` and `x-auth-password`).
     The vault holds one secret, so the password goes in the vault and the username is sent as
     a fixed header parameter (`IOFFICE_USERNAME`). This is how the files are set up now.
     **It's a workaround: test it early.** If Copilot won't send the username header,
     ask Eptura for token-based access.
   - **OAuth**: also supported by Copilot (`OAuthPluginVault`), but it needs different setup.
3. **A dedicated integration user** with permission only to read categories and create
   service requests.
4. **The endpoint that lists service request categories** and what its response looks like.
5. **The endpoint that creates a service request**, its required fields and its response.
6. **What a link to a ticket looks like** in the iOFFICE web app.

Then update `openapi.yaml`. Each `TODO` marks a path, field name or header to check. If the
response field names differ, also update `response_semantics` and the card in `ai-plugin.json`.

## Step 2: Fill in the settings

Edit `env/.env.dev`: `IOFFICE_API_BASE_URL`, `IOFFICE_AUTH_HEADER`, `IOFFICE_USERNAME`,
`IOFFICE_TICKET_URL_PREFIX`. None of these are secret.

## Step 3: Install the agent

You need a **Microsoft 365 Copilot licence** (or pay-as-you-go agents enabled by your admin),
and your admin must allow **uploading custom apps** (Teams admin center > Teams apps > Setup
policies), or approve the agent under Microsoft 365 admin center > Integrated apps.

### Option A: Microsoft 365 Agents Toolkit (recommended)

1. Install the **Microsoft 365 Agents Toolkit** extension in VS Code and open this folder.
2. Create `env/.env.dev.user` (git-ignored) with the secret:
   ```
   SECRET_IOFFICE_API_KEY=the-integration-user-password-or-token
   ```
3. Sign in with your Microsoft 365 account in the toolkit and choose **Provision**. It
   registers the app, stores the secret in the API key vault, fills in `TEAMS_APP_ID` and
   `IOFFICE_API_KEY_REGISTRATION_ID`, and installs the agent for you.

### Option B: by hand

1. Put a new GUID in `TEAMS_APP_ID` in `env/.env.dev` (any GUID generator, or
   `node -e "console.log(crypto.randomUUID())"`).
2. In the **Teams Developer Portal** (https://dev.teams.microsoft.com), go to
   **Tools > API key registration > New API key**:
   - **API key:** the integration user's password or token.
   - **Base URL:** the same value as `IOFFICE_API_BASE_URL`.
   - **Target tenant:** your organization only.
   - **Restrict usage by app:** your `TEAMS_APP_ID` (or *Any Teams app* while testing).
   Save, and copy the **API key registration ID** into `IOFFICE_API_KEY_REGISTRATION_ID`.
3. `npm run package` creates `appPackage/build/appPackage.dev.zip`.
4. In Teams: **Apps > Manage your apps > Upload an app > Upload a custom app** and choose the zip.

## Step 4: Try it

Open Copilot (in Outlook, Teams or https://m365.cloud.microsoft/chat), pick **iOFFICE Tickets
(dev)** from the agents list, and try:

- *"Show me the iOFFICE service request categories."* This tests the login and category list
  without creating anything.
- *"Which category would this go in: the AC on floor 3 is blowing warm air."*
- With an email open in Outlook: *"Create an iOFFICE ticket from this email."*

If you can, point `IOFFICE_API_BASE_URL` at an iOFFICE **test or sandbox instance** first,
so test tickets don't reach the real service desk.

### What to check while testing

- Does it pick the **right category** for your real emails? Category descriptions in iOFFICE
  matter most. If your categories have none, add guidance to `instruction.txt` (e.g. "badge and
  door access problems go in Security & Access Badges").
- Does it ask you to choose when it's unsure, rather than guessing?
- Does it find **the open email** in Outlook? How well this works depends on where Copilot is
  opened. If it doesn't, it can still search your mailbox (Email capability) or use pasted text.
- Is the drafted subject and description what your service desk wants to see?

After changing any file in `appPackage/`, run `npm test`, then provision or upload again.

## Security notes

- The secret lives only in the Microsoft 365 API key vault (and your git-ignored
  `env/.env.dev.user`). Never commit it.
- Everyone who uses the agent creates tickets **as the integration user**. The real requester
  is in the ticket's requester field, and the agent fills that in from the email. Give the
  integration user the smallest permissions that work.
- Copilot always shows a confirmation card before creating a ticket.
- To create tickets as each signed-in person instead, iOFFICE would need to support OAuth
  sign-in (`OAuthPluginVault`). Ask Eptura whether it does.
