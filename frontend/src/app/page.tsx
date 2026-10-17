import type { Metadata } from "next";
import { LandingPage } from "@/src/components/pages/LandingPage/LandingPage";

export const metadata: Metadata = { title: { absolute: "FightScore — судейство и табло для единоборств" } };

export default function Page() {
  return <LandingPage />;
}
