import type { Metadata } from "next";
import { TournamentDetailPage } from "@/src/components/pages/TournamentDetailPage/TournamentDetailPage";

export const metadata: Metadata = { title: "Турнир" };

export default function Page() {
  return <TournamentDetailPage />;
}
