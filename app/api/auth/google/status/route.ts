import { NextResponse } from "next/server";
import { isDriveConnected } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ connected: isDriveConnected() });
}
