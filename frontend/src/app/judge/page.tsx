import type { Metadata } from "next";
import { JudgeEntryPage } from "@/src/components/pages/JudgeEntryPage/JudgeEntryPage";

export const metadata: Metadata = { title: "Вход судьи" };

export default function Page() {
  return <JudgeEntryPage />;
}
