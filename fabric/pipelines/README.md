# Fabric ingestion pipeline

The Fabric Data Pipeline schedules the `01_bronze_duotrace_export` notebook. It does not run the live DuoTrace lookup.

Create the pipeline in the `DuoTrace Analytics` workspace, choose the uploaded notebook in a Notebook activity, run it manually once, then add a daily schedule. After Fabric creates the notebook and workspace IDs, export the real definition through Git integration and replace the template in this folder.
