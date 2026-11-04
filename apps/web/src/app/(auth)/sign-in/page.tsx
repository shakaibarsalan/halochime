import type { Metadata } from "next";
import { Suspense } from "react";
import { googleSignInEnabled } from "@/lib/auth";
import { AuthForm } from "../auth-form";
import { redirectIfSignedIn } from "../signed-in";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  await redirectIfSignedIn(searchParams);
  return (
    <Suspense>
      <AuthForm mode="sign-in" googleEnabled={googleSignInEnabled()} />
    </Suspense>
  );
}
