import { NextRequest, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase";
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const db = await serverSupabase();
    if (db) {
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL("/overview", req.url));
    }
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", req.url));
}
