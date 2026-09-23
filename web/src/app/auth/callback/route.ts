import { NextResponse } from "next/server";
import { authClient } from "@/lib/auth";
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (code) {
    const auth = await authClient();
    const { error } = await auth.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL("/dashboard/audience", process.env.APP_ORIGIN),
      );
  }
  return NextResponse.redirect(
    new URL("/?error=google_login_failed", process.env.APP_ORIGIN),
  );
}
