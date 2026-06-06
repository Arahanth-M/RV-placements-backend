# Interview Questions Admin (temporary)

Standalone tool for manually viewing/editing `InterviewQuestion` documents and running DSA test cases.

**Does not modify** the main app, docker-compose, routes, or any other collections.

## Run

From `RV-placements-backend/`:

```bash
node tools/interview-questions-admin/server.js
```

Open **http://localhost:7777**

If `backend-interview` is already on :7777, use another port:

```bash
IQ_ADMIN_PORT=7788 node tools/interview-questions-admin/server.js
```

Requires the same `.env` (`MONGO_URI`) as the backend. Code execution needs Docker (same as interview preview).

### Troubleshooting "no output"

You should see logs immediately:

```
[iq-admin] Starting Interview Questions Admin…
[iq-admin] Port: 7777
[iq-admin] Loading modules…
[iq-admin] Connecting to MongoDB…
```

If it stops at **Connecting to MongoDB**, your `MONGO_URI` is unreachable (Atlas IP whitelist, VPN, or local `mongod` not running). The UI still opens; the list will show a DB error until Mongo connects.

Run from **`RV-placements-backend/`** (where `.env` lives).

## Delete when done

Remove this entire folder:

```bash
rm -rf tools/interview-questions-admin
```

No other files need to be reverted.
