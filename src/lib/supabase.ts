import { AuthClient } from "@supabase/auth-js";

/** Cliente de Supabase solo para AUTENTICACION. Los datos se piden a nuestra
 *  API (`/api/analisis`), que reenvia el JWT a PostgREST; asi el contrato de
 *  datos sigue en un solo lugar y las pruebas siguen sirviendo.
 *
 *  La anon key esta disenada para ser publica: lo que protege los datos es el
 *  RLS con lista blanca, no que la clave sea secreta. */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const faltaConfig = !url || !anon;

export const supabase = faltaConfig
  ? null
  : { auth: new AuthClient({
      url: `${url!}/auth/v1`,
      headers: { apikey: anon!, Authorization: `Bearer ${anon!}` },
      storageKey: `sb-${new URL(url!).hostname.split(".")[0]}-auth-token`,
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
    }) };
