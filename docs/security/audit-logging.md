## Audit Logging

NemoClaw records a tamper-evident audit trail of gateway and orchestrator events, ensuring that a sandboxed agent cannot cover its tracks by modifying log history.

### Problem

In the default configuration prior to this change, all logs lived under `/tmp/`, which is fully writable by the sandbox user. An agent could silently delete, truncate, or rewrite its own audit trail — making post-incident forensics unreliable.

### Solution

The fix applies three independent layers of protection:

1. **Log isolation** — Logs are written to `/var/log/nemoclaw/` instead of `/tmp/`. The directory is owned by `root:sandbox` with mode 750, and the sandbox policy marks `/var/log` as read-only.

2. **Append-only enforcement** — The `audit.jsonl` file has the `chattr +a` (append-only) attribute set at image build time. Even with group-write permission, the kernel prevents any operation other than appending.

3. **Hash chaining** — Each log entry includes a SHA-256 hash of its payload and a `prev_hash` field linking to the previous entry. Any modification breaks the chain and is detectable offline.

### Verifying the audit chain

Run the built-in verification command against any audit log file:

```bash
python3 -m nemoclaw_blueprint.orchestrator.audit verify /var/log/nemoclaw/audit.jsonl
```

Output on a valid chain:

```
entries: 42
chain:   valid ✓
```

If tampering is detected, the tool reports the exact line where the chain broke:

```
entries: 17
chain:   BROKEN ✗
detail:  line 18: hash mismatch (tampering detected)
```

### Future work

- **Remote SIEM shipping** — Forward audit events to Splunk or Elasticsearch in real time so that even host-level compromise cannot suppress the trail.
- **Landlock enforce mode** — Move from `best_effort` to `enforce` once the kernel compatibility matrix is validated across deployment targets.
