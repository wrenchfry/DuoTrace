# Cloudflare D1 setup

D1 stores completed DuoTrace searches so Fabric can ingest data produced by the real application.

## Create and bind the database

1. Create the database:

   ```powershell
   npx wrangler d1 create duotrace-analytics
   ```

2. Copy the returned database ID into `wrangler.jsonc`:

   ```jsonc
   "d1_databases": [
     {
       "binding": "ANALYTICS_DB",
       "database_name": "duotrace-analytics",
       "database_id": "PASTE_THE_DATABASE_ID_HERE"
     }
   ]
   ```

3. Apply the migration:

   ```powershell
   npx wrangler d1 execute duotrace-analytics --remote --file migrations/0001_analytics_searches.sql
   ```

4. Generate a long random export token and save it as a Worker secret:

   ```powershell
   npx wrangler secret put ANALYTICS_EXPORT_TOKEN
   ```

5. Deploy the Worker:

   ```powershell
   npm run deploy
   ```

The Worker records no browser identity, IP address, or API key in D1. It saves only the completed DuoTrace search and its shared-match results.
