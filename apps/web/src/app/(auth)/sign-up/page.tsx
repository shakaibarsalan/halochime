import type { Metadata } from "next";
import { Suspense } from "react";
import { googleSignInEnabled } from "@/lib/auth";
import { AuthForm } from "../auth-form";
import { redirectIfSignedIn } from "../signed-in";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  await redirectIfSignedIn(searchParams);
  return (
    <Suspense>
      <AuthForm mode="sign-up" googleEnabled={googleSignInEnabled()} />
    </Suspense>
  );
}
