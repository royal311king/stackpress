import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { google } from "googleapis";

import { googleOAuthService } from "./google-oauth";

export type GoogleDriveFile = {
  id: string;
  name: string;
  size: number | null;
  md5Checksum: string | null;
  sha256Checksum: string | null;
  webViewLink: string | null;
  createdTime: string | null;
  trashed: boolean;
  parents: string[];
  appProperties: Readonly<Record<string, string>>;
};

export type GoogleDriveUploadInput = {
  name: string;
  parentId: string;
  localPath: string;
  mimeType: string;
  appProperties: Readonly<Record<string, string>>;
  onProgress?: (bytesUploaded: number) => void;
};

export interface GoogleDriveClient {
  testConnection(): Promise<{ accountEmail: string | null }>;
  findFolder(name: string, parentId?: string): Promise<GoogleDriveFile | null>;
  createFolder(
    name: string,
    parentId: string | undefined,
    appProperties: Readonly<Record<string, string>>
  ): Promise<GoogleDriveFile>;
  findManagedBackupFile(
    backupId: string,
    artifactKind: string,
    parentId: string
  ): Promise<GoogleDriveFile | null>;
  uploadFile(input: GoogleDriveUploadInput): Promise<GoogleDriveFile>;
  getFile(fileId: string): Promise<GoogleDriveFile | null>;
  downloadFile(
    fileId: string,
    destinationPath: string,
    onProgress?: (bytesDownloaded: number) => void
  ): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
  listManagedFiles(options?: {
    siteId?: string;
    pageToken?: string;
    pageSize?: number;
  }): Promise<{ files: GoogleDriveFile[]; nextPageToken: string | null }>;
}

function escapeQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function normalizeFile(value: {
  id?: string | null;
  name?: string | null;
  size?: string | null;
  md5Checksum?: string | null;
  sha256Checksum?: string | null;
  webViewLink?: string | null;
  createdTime?: string | null;
  trashed?: boolean | null;
  parents?: string[] | null;
  appProperties?: { [key: string]: string } | null;
}): GoogleDriveFile {
  if (!value.id) throw new Error("Google Drive response did not include a file ID");
  return {
    id: value.id,
    name: value.name ?? value.id,
    size: value.size ? Number(value.size) : null,
    md5Checksum: value.md5Checksum ?? null,
    sha256Checksum: value.sha256Checksum ?? null,
    webViewLink: value.webViewLink ?? null,
    createdTime: value.createdTime ?? null,
    trashed: Boolean(value.trashed),
    parents: value.parents ?? [],
    appProperties: value.appProperties ?? {}
  };
}

const FILE_FIELDS = "id,name,size,md5Checksum,sha256Checksum,webViewLink,createdTime,trashed,parents,appProperties";

export async function createOfficialGoogleDriveClient(
  connectionId: string
): Promise<GoogleDriveClient> {
  const auth = await googleOAuthService.authorizedClient(connectionId);
  const drive = google.drive({ version: "v3", auth: auth as never });

  async function listOne(q: string) {
    const response = await drive.files.list({
      q,
      spaces: "drive",
      pageSize: 1,
      orderBy: "createdTime asc",
      fields: `files(${FILE_FIELDS})`
    });
    const file = response.data.files?.[0];
    return file ? normalizeFile(file) : null;
  }

  return {
    async testConnection() {
      const response = await drive.about.get({ fields: "user(emailAddress)" });
      return { accountEmail: response.data.user?.emailAddress ?? null };
    },
    findFolder(name, parentId) {
      const parentQuery = parentId ? ` and '${escapeQueryValue(parentId)}' in parents` : "";
      return listOne(
        `name = '${escapeQueryValue(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentQuery}`
      );
    },
    async createFolder(name, parentId, appProperties) {
      const response = await drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: parentId ? [parentId] : undefined,
          appProperties: { ...appProperties }
        },
        fields: FILE_FIELDS
      });
      return normalizeFile(response.data);
    },
    findManagedBackupFile(backupId, artifactKind, parentId) {
      return listOne(
        `'${escapeQueryValue(parentId)}' in parents and trashed = false and ` +
        `appProperties has { key='stackpressBackupId' and value='${escapeQueryValue(backupId)}' } and ` +
        `appProperties has { key='stackpressArtifactKind' and value='${escapeQueryValue(artifactKind)}' }`
      );
    },
    async uploadFile(input) {
      const response = await drive.files.create(
        {
          uploadType: "resumable",
          requestBody: {
            name: input.name,
            parents: [input.parentId],
            appProperties: { ...input.appProperties }
          },
          media: {
            mimeType: input.mimeType,
            body: fs.createReadStream(input.localPath)
          },
          fields: FILE_FIELDS
        },
        {
          onUploadProgress: (event) => input.onProgress?.(event.bytesRead)
        }
      );
      return normalizeFile(response.data);
    },
    async getFile(fileId) {
      try {
        const response = await drive.files.get({ fileId, fields: FILE_FIELDS });
        return normalizeFile(response.data);
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 404) return null;
        throw error;
      }
    },
    async downloadFile(fileId, destinationPath, onProgress) {
      const response = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream" }
      );
      let bytesDownloaded = 0;
      response.data.on("data", (chunk: Buffer | string) => {
        bytesDownloaded += Buffer.byteLength(chunk);
        onProgress?.(bytesDownloaded);
      });
      await pipeline(response.data, fs.createWriteStream(destinationPath, { flags: "wx" }));
    },
    async deleteFile(fileId) {
      await drive.files.delete({ fileId });
    },
    async listManagedFiles(options = {}) {
      const clauses = [
        "trashed = false",
        "appProperties has { key='stackpressManaged' and value='true' }"
      ];
      if (options.siteId) {
        clauses.push(
          `appProperties has { key='stackpressSiteId' and value='${escapeQueryValue(options.siteId)}' }`
        );
      }
      const response = await drive.files.list({
        q: clauses.join(" and "),
        spaces: "drive",
        pageToken: options.pageToken,
        pageSize: Math.min(options.pageSize ?? 100, 1000),
        orderBy: "createdTime desc",
        fields: `nextPageToken,files(${FILE_FIELDS})`
      });
      return {
        files: (response.data.files ?? []).map(normalizeFile),
        nextPageToken: response.data.nextPageToken ?? null
      };
    }
  };
}
