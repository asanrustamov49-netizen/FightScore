import type { Metadata } from "next";
import { RuleProfilePage } from "@/src/components/pages/RuleProfilePage/RuleProfilePage";

export const metadata: Metadata = { title: "Профиль правил" };

export default function Page() {
  return <RuleProfilePage />;
}
