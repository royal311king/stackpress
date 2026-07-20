import { NextRequest, NextResponse } from "next/server";

import {
  AdminAuthorizationError,
  requireStackPressAdmin
} from "@/lib/auth/admin";
import { cloudConnectionService } from "@/lib/services/cloud-storage/connections";

export async function GET(request: NextRequest) {
  try {
    requireStackPressAdmin(request);
    return NextResponse.json({ connections: await cloudConnectionService.list() });
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.status,
          headers: error.status === 401
            ? { "WWW-Authenticate": 'Basic realm="StackPress Administrator"' }
            : undefined
        }
      );
    }
    return NextResponse.json({ error: "Unable to list cloud connections" }, { status: 400 });
  }
}
