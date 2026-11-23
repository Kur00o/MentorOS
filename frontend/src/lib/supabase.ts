import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when the deployment has no Supabase configuration — the UI then
 *  shows a clear setup message instead of crashing. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "mentoros-auth" },
      })
    : null;

export const authConfigured = Boolean(supabase);
export const googleEnabled = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";
