import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { REMOTE_DELETE_CONFIRMATION, remoteActionRequest } from "./cloud-upload-actions";
import { getLocalBackupDeleteWarning } from "./forms";

describe("backup history cloud actions", () => {
  test("queues manual uploads without running them in the browser", () => {
    const request = remoteActionRequest("backup-1", "drive-1", "upload");
    assert.equal(request.url, "/api/backups/backup-1/cloud-uploads");
    assert.equal(request.init.method, "POST");
    assert.match(String(request.init.body), /drive-1/);
  });

  test("targets retry, verify, download, delete, and restore endpoints", () => {
    assert.equal(remoteActionRequest("b", "c", "retry", "job-1").url, "/api/cloud-storage/uploads/job-1/retry");
    for (const action of ["verify", "download", "delete", "restore"] as const) {
      assert.equal(remoteActionRequest("b", "c", action).url, `/api/backups/b/cloud/c/${action}`);
    }
  });

  test("remote deletion confirmation explicitly preserves the local backup", () => {
    assert.match(REMOTE_DELETE_CONFIRMATION, /local backup will remain unchanged/i);
  });

  test("local deletion warns when no verified remote copy exists", () => {
    assert.match(getLocalBackupDeleteWarning(false), /No verified remote copy exists/i);
    assert.match(getLocalBackupDeleteWarning(true), /verified remote copy/i);
  });
});
