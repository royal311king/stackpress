import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const targetPath = path.resolve(String(body.path ?? ""));
    if (!targetPath || targetPath === path.parse(targetPath).root) {
      return NextResponse.json({ error: "Choose a specific folder to create." }, { status: 400 });
    }

    fs.mkdirSync(targetPath, { recursive: true });
    return NextResponse.json({ path: targetPath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create folder" },
      { status: 400 }
    );
  }
}
