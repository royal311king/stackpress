import { NextResponse } from "next/server";

import { startScheduler } from "@/lib/services/scheduler";

export async function POST() {
  await startScheduler();
  return NextResponse.json({ ok: true });
}
