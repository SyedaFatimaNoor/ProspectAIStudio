import { NextRequest, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase";

// Keep recovery redirects local and allowlisted. Never redirect to a URL supplied
// by an email-link query string.
function destination(next: string | null) {
  return next === "/reset-password" ? next : "/overview";
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const db = await serverSupabase();
    if (db) {
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error)
        return NextResponse.redirect(
          new URL(destination(req.nextUrl.searchParams.get("next")), req.url),
        );
    }
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", req.url));
}
