import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

function safePath(value: string | null) {
  const requested = value && value.trim() ? value.trim() : "/";
  return path.resolve(requested);
}

export async function GET(request: NextRequest) {
  const currentPath = safePath(request.nextUrl.searchParams.get("path"));

  try {
    const stats = fs.statSync(currentPath);
    const directory = stats.isDirectory() ? currentPath : path.dirname(currentPath);
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .map((entry) => {
        const entryPath = path.join(directory, entry.name);
        return {
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
        };
      })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({
      currentPath: directory,
      parentPath: path.dirname(directory),
      entries
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to browse that path" },
      { status: 400 }
    );
  }
}
