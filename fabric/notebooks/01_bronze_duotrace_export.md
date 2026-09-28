# Bronze DuoTrace export notebook

`01_bronze_duotrace_export.ipynb` retrieves real completed searches from DuoTrace. It uses an incremental cursor, preserves each response record as JSON, and records its own checkpoint and run status.

Before the first run, create the Cloudflare D1 database, apply `migrations/0001_analytics_searches.sql`, bind it to the Worker as `ANALYTICS_DB`, and configure `ANALYTICS_EXPORT_TOKEN` as a Worker secret. Store that same export token in Azure Key Vault for Fabric.

The notebook creates three Lakehouse tables:

- `bronze_duotrace_search_raw`
- `ops_duotrace_export_checkpoint`
- `ops_duotrace_export_run_log`
