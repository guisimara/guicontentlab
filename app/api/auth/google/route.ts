import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google-drive";

export const runtime = "nodejs";

// Kicks off the OAuth2 consent flow — redirects the browser to Google.
export async function GET() {
  try {
    const url = getAuthUrl();
    return NextResponse.redirect(url);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
