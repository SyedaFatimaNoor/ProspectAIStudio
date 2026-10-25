import { createServerClient } from "@supabase/ssr";
import { supabaseUrl, supabasePublishableKey } from "./supabase-config";
import { cookies } from "next/headers";
export async function serverSupabase() {
  const store = await cookies();
  const url = supabaseUrl;
  const key = supabasePublishableKey;
  if (!url || !key) return null;
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server component cannot set cookies; route handlers can. */
        }
      },
    },
  });
}
