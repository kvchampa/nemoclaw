#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""Tamper-evident audit logger with SHA-256 hash chaining.

Each log entry is a JSON object appended to a JSONL file. Entries are
cryptographically chained: every record includes the SHA-256 hash of
the previous entry, so any modification or deletion breaks the chain
and is detectable via `verify_chain`.
"""

import hashlib
import json
import os
import sys
import time
from pathlib import Path

AUDIT_FILENAME = "audit.jsonl"


def _hash_payload(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def init_audit_log(log_dir: str) -> str:
    """Create the log directory (if needed) and return the audit file path."""
    path = Path(log_dir)
    path.mkdir(parents=True, exist_ok=True)
    audit_path = path / AUDIT_FILENAME
    # Touch the file so it exists, but don't truncate if already present
    audit_path.touch(exist_ok=True)
    return str(audit_path)


def append_event(log_file: str, event: dict, prev_hash: str) -> str:
    """Append a hash-chained event to the audit log. Returns the entry hash."""
    record = {
        "timestamp": time.time(),
        "prev_hash": prev_hash,
        "event": event,
    }
    payload = json.dumps(record, separators=(",", ":"), sort_keys=True)
    entry_hash = _hash_payload(payload)
    record["hash"] = entry_hash

    with open(log_file, "a") as f:
        f.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")

    return entry_hash


def verify_chain(log_file: str) -> tuple:
    """Validate the hash chain in an audit log.

    Returns (valid, entry_count, error_message). On success error_message
    is empty. On failure it describes where the chain broke.
    """
    prev_hash = None
    count = 0

    with open(log_file, "r") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                return (False, count, f"line {lineno}: invalid JSON — {exc}")

            stored_hash = record.pop("hash", None)
            if stored_hash is None:
                return (False, count, f"line {lineno}: missing hash field")

            # Recompute hash from the record without the hash field
            payload = json.dumps(record, separators=(",", ":"), sort_keys=True)
            expected = _hash_payload(payload)
            if stored_hash != expected:
                return (False, count, f"line {lineno}: hash mismatch (tampering detected)")

            # Check chain linkage (first entry has no constraint on prev_hash)
            if prev_hash is not None and record.get("prev_hash") != prev_hash:
                return (False, count, f"line {lineno}: chain break — prev_hash doesn't match previous entry")

            prev_hash = stored_hash
            count += 1

    return (True, count, "")


def _cli_verify(path: str) -> int:
    """Run chain verification and print results."""
    if not os.path.isfile(path):
        print(f"error: {path} not found", file=sys.stderr)
        return 1

    valid, count, err = verify_chain(path)
    print(f"entries: {count}")
    if valid:
        print("chain:   valid ✓")
        return 0
    else:
        print(f"chain:   BROKEN ✗")
        print(f"detail:  {err}")
        return 1


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] != "verify":
        print(f"usage: python3 -m nemoclaw_blueprint.orchestrator.audit verify <file>")
        sys.exit(2)
    sys.exit(_cli_verify(sys.argv[2]))
