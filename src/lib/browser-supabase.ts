"use client";
import { supabaseUrl, supabasePublishableKey } from "./supabase-config";
import { createBrowserClient } from "@supabase/ssr";
export function browserSupabase() {
  const url = supabaseUrl;
  const key = supabasePublishableKey;
  return url && key ? createBrowserClient(url, key) : null;
}
