import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { POST as enqueueUpload } from "@/app/api/backups/[id]/cloud-uploads/route";
import { POST as retryUpload } from "@/app/api/cloud-storage/uploads/[id]/retry/route";

describe("cloud upload administrator authorization", () => {
  test("rejects an unauthenticated manual cloud upload before reading request data", async () => {
    const response = await enqueueUpload(
      new Request("http://localhost/api/backups/backup-1/cloud-uploads", { method: "POST" }),
      { params: Promise.resolve({ id: "backup-1" }) }
    );
    assert.ok(response.status === 401 || response.status === 503);
    assert.match((await response.json()).error, /Administrator authentication/);
  });

  test("rejects an unauthenticated cloud retry before accessing the database", async () => {
    const response = await retryUpload(
      new Request("http://localhost/api/cloud-storage/uploads/job-1/retry", { method: "POST" }),
      { params: Promise.resolve({ id: "job-1" }) }
    );
    assert.ok(response.status === 401 || response.status === 503);
    assert.match((await response.json()).error, /Administrator authentication/);
  });
});
