import type { Metadata } from "next";
import { RulesPage } from "@/src/components/pages/RulesPage/RulesPage";

export const metadata: Metadata = { title: "Профили правил" };

export default function Page() {
  return <RulesPage />;
}
