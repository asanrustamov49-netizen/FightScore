import type { Metadata } from "next";
import { MatchDetailPage } from "@/src/components/pages/MatchDetailPage/MatchDetailPage";

export const metadata: Metadata = { title: "Поединок" };

export default function Page() {
  return <MatchDetailPage />;
}
