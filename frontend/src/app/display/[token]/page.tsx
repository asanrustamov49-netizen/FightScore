import type { Metadata } from "next";
import { Suspense } from "react";
import { DisplayPage } from "@/src/components/pages/DisplayPage/DisplayPage";

export const metadata: Metadata = { title: "Табло" };

export default function Page() {
  return (
    <Suspense>
      <DisplayPage />
    </Suspense>
  );
}
