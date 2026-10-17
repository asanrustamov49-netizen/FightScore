import type { Metadata } from "next";
import { RulesPage } from "@/src/components/pages/RulesPage/RulesPage";

export const metadata: Metadata = { title: "Правила" };

export default function Page() {
  return <RulesPage />;
}
