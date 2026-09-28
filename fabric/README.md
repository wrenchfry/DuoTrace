# DuoTrace Fabric platform

This folder contains the analytics platform connected to the DuoTrace application.

The Cloudflare Worker remains responsible for the live Riot API lookup. After a user searches any two Riot IDs, the app records the completed search and its shared matches in Cloudflare D1. Microsoft Fabric ingests those saved application records on a schedule for reporting and data-quality monitoring.

## Planned flow

1. DuoTrace performs a live lookup for any pair of Riot IDs.
2. The Worker stores a completed search event in Cloudflare D1.
3. A protected Worker export endpoint returns new search events to Fabric.
4. A Fabric notebook stores the unmodified export in Bronze tables.
5. Silver and Gold transformations prepare reporting tables and quality results.
6. A Fabric Warehouse and Power BI report expose the analytics model.

See [architecture.md](architecture.md) for the planned design.

## Folder guide

- `notebooks/` holds Fabric PySpark notebooks.
- `pipelines/` holds Fabric Data Pipeline definitions and setup notes.
- `docs/` holds the data contract, data dictionary, and operational runbook.
- `sql/` holds Warehouse schema and view scripts.
