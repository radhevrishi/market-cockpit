# Market Cockpit MCP server (read-only)

Lets Claude (or any MCP client) query Market Cockpit data directly. Every tool only reads: no writes, no paid AI calls.

## Connect

- URL: `https://<your-app-host>/api/v1/mcp`
- Transport: MCP "Streamable HTTP", JSON-RPC 2.0 over `POST`. Answers are plain `application/json` (no SSE stream, no sessions).
- Auth: send the service key in the header `x-mc-key: <service key>` (or be logged in as the owner in the browser).
  Without it the proxy answers 401. The key is the one already set on the server; never put it in a file or a commit.

Example (Claude Code):

```bash
claude mcp add --transport http market-cockpit https://<your-app-host>/api/v1/mcp --header "x-mc-key: $MC_SERVICE_KEY"
```

Quick check with curl:

```bash
curl -s https://<your-app-host>/api/v1/mcp -H "x-mc-key: $MC_SERVICE_KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Methods

`initialize` (protocol `2025-06-18`), `notifications/initialized` (202, no body), `ping`, `tools/list`, `tools/call`.
`GET` returns 405.

## Tools

| Tool | Arguments | What it returns |
|---|---|---|
| `get_company` | `ticker` (required) | The full company record: latest graded result, active guidance, archived events, AI-read documents, India technicals. Each section is OK / NOT_FOUND / UNAVAILABLE with its source. |
| `get_guidance` | `ticker?`, `market?` (`IN`/`US`/`ALL`), `min_growth?` (percent) | Active guidance rows: company, ticker, market, metric, display, period, verification, statement, source name/URL/date. Max 200 rows. |
| `get_events` | `ticker?`, `market?`, `since?` (`YYYY-MM-DD`), `status?`, `limit?` (1-200, default 50) | Guidance change events archived in Postgres (`intel_event`), newest first. |
| `explain_score` | `ticker` (required) | For a Conviction Beats bench name (India, then USA): the "new information" score with every part and its points, price check, missing data, plus tier, composite and growth figures. |

Tickers must match `^[A-Z0-9][A-Z0-9&.\-]{0,19}$` (prefixes like `NSE:` and suffixes like `.NS` are stripped).
Bad arguments give JSON-RPC error `-32602`; an unknown method gives `-32601`; a data store that is down gives a tool result with `isError: true`.

Code: dispatch and schemas in `src/lib/mcp-server.ts`, tests in `src/lib/__tests__/zzz896-mcp.test.ts`.
