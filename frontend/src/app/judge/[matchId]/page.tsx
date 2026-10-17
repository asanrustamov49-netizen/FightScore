import type { Metadata } from "next";
import { Suspense } from "react";
import { JudgePanelPage } from "@/src/components/pages/JudgePanelPage/JudgePanelPage";

export const metadata: Metadata = { title: "Судейская панель" };

export default function Page() {
  return (
    <Suspense>
      <JudgePanelPage />
    </Suspense>
  );
}
