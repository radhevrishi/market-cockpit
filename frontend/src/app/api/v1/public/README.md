# Market Cockpit — Public Read-only API

Read-only endpoints for embed widgets, partner dashboards, and third-party
clients. Scaffolded in Patch 0311.

## Auth

Pass `?key=<api-key>` on every request. Configure allowed keys via the
`PUBLIC_API_KEYS` env var (comma-separated). Set `PUBLIC_API_ANON=1` to
permit anonymous access.

## Rate limiting

60 requests per hour per key (or per IP for anonymous). 429 returned on
overage with `Retry-After` headers. Counters in Upstash KV, sliding
window.

## Endpoints

### `GET /api/v1/public/graded/<YYYY-MM-DD>`

Redacted graded-earnings list for the requested filing date.

**Fields returned**
- `symbol`, `company`, `sector`
- `grade` (BLOCKBUSTER / STRONG / NEUTRAL / WEAK / SKIP)
- `composite_score` (0-100)
- `magnitude_summary` (one-line summary of YoY deltas)
- `filing_date`
- `methodology_tags` (high-level: e.g. `["Trend Template", "CANSLIM"]`)

**Fields explicitly dropped**
- Internal scoring weights and feature vectors
- Audit trail / classifier rationale
- Post-gap price-action details
- News evidence URLs and snippets (subscriber-only)

**Response**
```json
{
  "date": "2026-05-12",
  "total": 17,
  "cards": [ { ... } ],
  "counts_by_grade": { "BLOCKBUSTER": 2, "STRONG": 5, "NEUTRAL": 8, "WEAK": 2 },
  "api_version": "1",
  "generated_at": "2026-05-12T18:30:00.000Z"
}
```

**Cache headers**: `Cache-Control: public, max-age=300, stale-while-revalidate=600`
so CDN-fronted callers can keep this hot for 5 minutes.

## Future endpoints (planned)

- `GET /api/v1/public/breadth` — 5-pillar market breadth composite
- `GET /api/v1/public/movers/<region>` — top gainers/losers
- `GET /api/v1/public/transmission/<commodity>` — sensitivity matrix per commodity

These will follow the same auth + rate-limit + redaction pattern.

## Versioning

Breaking changes ship under a new path prefix (`/api/v2/public/*`). The
`api_version` field in every response advertises the active version so
clients can detect format drift.
