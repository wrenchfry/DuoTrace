# DuoTrace analytics export contract

The Cloudflare Worker exposes `GET /api/analytics/export` for Fabric only.

## Authentication

The request must include the following header:

```text
Authorization: Bearer <analytics export token>
```

Fabric retrieves the token from Azure Key Vault. The token is never committed to this repository or sent to the browser.

## Incremental export

The endpoint accepts two optional query parameters:

- `after`: the last processed numeric sequence, starting at `0`.
- `limit`: number of records to return, from `1` to `500`.

The response returns `records`, `nextCursor`, and `hasMore`. The Bronze notebook saves the returned records unchanged and updates its checkpoint only after a successful write.

## Search record

Each record represents one completed DuoTrace search. It contains the two Riot IDs, routing region, search time, shared-match count, and the normalized shared-match results displayed by the app.
