import type { Metadata } from "next";
import { Suspense } from "react";
import { ProtocolPage } from "@/src/components/pages/ProtocolPage/ProtocolPage";
import { Loading } from "@/src/components/ui/Notice/Notice";

export const metadata: Metadata = { title: "Протокол результатов" };

// Outside the dashboard layout on purpose: a document for printing, with no menu around it.
// Suspense: the page reads the tournament id from the URL at runtime.
export default function Page() {
  return (
    <Suspense fallback={<Loading label="Готовим протокол…" />}>
      <ProtocolPage />
    </Suspense>
  );
}
