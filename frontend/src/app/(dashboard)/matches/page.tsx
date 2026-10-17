import type { Metadata } from "next";
import { MatchesPage } from "@/src/components/pages/MatchesPage/MatchesPage";

export const metadata: Metadata = { title: "Поединки" };

export default function Page() {
  return <MatchesPage />;
}
