import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginPage } from "@/src/components/pages/LoginPage/LoginPage";

export const metadata: Metadata = { title: "Вход" };

export default function Page() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
