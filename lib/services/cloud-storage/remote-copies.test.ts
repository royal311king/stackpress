import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { safeGoogleDriveFolderUrl } from "./remote-copies";

describe("remote backup links", () => {
  test("generates links only for safe Google Drive folder IDs", () => {
    assert.equal(safeGoogleDriveFolderUrl("folder_ABC-123"), "https://drive.google.com/drive/folders/folder_ABC-123");
    assert.equal(safeGoogleDriveFolderUrl("../unsafe?token=secret"), null);
    assert.equal(safeGoogleDriveFolderUrl(null), null);
  });
});
