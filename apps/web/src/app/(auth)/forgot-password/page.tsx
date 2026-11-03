import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
