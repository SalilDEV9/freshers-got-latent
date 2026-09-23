import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export async function authClient() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          for (const { name, value, options } of items)
            jar.set(name, value, options);
        },
      },
    },
  );
}
export async function identity() {
  const auth = await authClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user || !user.email_confirmed_at)
    throw new Error("Sign in with Google");
  const google = user.identities?.find(
    (i) =>
      i.provider === "google" &&
      i.identity_data?.email_verified === true &&
      String(i.identity_data.email).toLowerCase() === user.email?.toLowerCase(),
  );
  if (!google) throw new Error("A verified Google email is required");
  return { id: user.id, email: user.email!.toLowerCase() };
}
