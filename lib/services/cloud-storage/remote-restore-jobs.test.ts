import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import {
  cleanupStaleRestoreDirectories
} from "./remote-restore-jobs";
import { requiredBackupArtifactKinds } from "./types";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true }))));

describe("remote restore temporary cleanup", () => {
  test("requires only the artifacts used by the original backup mode", () => {
    assert.deepEqual(requiredBackupArtifactKinds("database"), ["database"]);
    assert.deepEqual(requiredBackupArtifactKinds("files"), ["files"]);
    assert.deepEqual(requiredBackupArtifactKinds("full"), ["database", "files"]);
  });

  test("removes interrupted stale restore directories but preserves unrelated and active directories", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stackpress-cleanup-test-"));
    roots.push(root);
    const stale = path.join(root, "stackpress-restore-stale");
    const active = path.join(root, "stackpress-restore-active");
    const unrelated = path.join(root, "other-data");
    await Promise.all([stale, active, unrelated].map((directory) => fs.promises.mkdir(directory)));
    const now = new Date("2026-07-15T12:30:00.000Z");
    await fs.promises.utimes(stale, new Date("2026-07-14T11:00:00.000Z"), new Date("2026-07-14T11:00:00.000Z"));
    await fs.promises.utimes(active, now, now);
    await cleanupStaleRestoreDirectories(now, root);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(active), true);
    assert.equal(fs.existsSync(unrelated), true);
  });
});
