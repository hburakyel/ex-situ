# Deploy

Pushing to `main` deploys automatically once CI passes (`.github/workflows/ci.yml`):

1. **Frontend Build** and **Backend Check** run.
2. **Detect database changes** looks at the pushed files. If any of these changed,
   the deploy **waits for approval** (environment `production-db`):
   - `backend/database/` (SQL migrations — these are run by hand, never by the deploy)
   - `backend/src/api/*/content-types/`, `backend/src/components/` (Strapi alters
     tables from these on start; removing a field can drop its column)
   - `backend/config/database*`

   The run summary lists the files. Run any new migration on the server, then
   approve the deploy in the Actions tab.
3. **Deploy** SSHes to the server with a key that can only run
   `scripts/deploy/remote-entry.sh`, which checks out the commit and runs
   `scripts/deploy/deploy.sh`:
   - backend changed → database backup (last 7 kept), `npm ci` if dependencies
     changed, restart Strapi, wait for the map API (~2 min while map views rebuild)
   - frontend changed → build into the inactive of `.next-a`/`.next-b` while the
     site keeps serving, switch over, switch back if the new build doesn't answer

Deploys never change data. Imports and fixes (`etl/`) stay manual: dry run, review, `--apply`.

## One-time setup (GitHub → Settings)

- **Environments**: create `production-db` with *Required reviewers* = you.
  Create `production` (no protection).
- **Secrets → Actions**: `DEPLOY_HOST`, `DEPLOY_SSH_KEY` (private deploy key),
  `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <host>` output).
- **Variables → Actions**: `DEPLOY_ENABLED` = `true`. Without it the deploy jobs are skipped.

## Server side

- `remote-entry.sh` is installed as the key's forced command in `authorized_keys`
  (`command="…",restrict`). It only accepts `deploy <sha>` for a commit on
  `origin/main`, never moves to an older commit, and runs one deploy at a time.
- Last successful deploy: `/var/lib/exsitu-deploy/deployed-sha`; log: `/var/log/exsitu-deploy.log`;
  backups: `/var/backups/exsitu/`.
- Restore a backup: `sudo -u postgres pg_restore --clean -d <db> <file>.dump`, then restart the backend.
- Manual deploy is still possible: `ssh` in and run the same `deploy.sh`.
