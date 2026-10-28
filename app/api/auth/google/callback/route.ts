import { NextRequest, NextResponse } from "next/server";
import { handleOAuthCallback } from "@/lib/google-drive";

export const runtime = "nodejs";

// Google redirects here after the user approves (or denies) access.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const base = req.nextUrl.origin;

  if (error) {
    return NextResponse.redirect(`${base}/?driveAuth=denied`);
  }
  if (!code) {
    return NextResponse.redirect(`${base}/?driveAuth=error`);
  }

  try {
    await handleOAuthCallback(code);
    return NextResponse.redirect(`${base}/?driveAuth=success`);
  } catch (err: any) {
    return NextResponse.redirect(`${base}/?driveAuth=error`);
  }
}
