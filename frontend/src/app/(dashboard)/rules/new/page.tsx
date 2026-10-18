import type { Metadata } from "next";
import { RuleEditorPage } from "@/src/components/pages/RuleEditorPage/RuleEditorPage";

export const metadata: Metadata = { title: "Новый профиль правил" };

export default function Page() {
  return <RuleEditorPage />;
}
