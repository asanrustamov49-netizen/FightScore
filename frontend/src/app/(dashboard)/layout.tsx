import { Suspense } from "react";
import { AppShell } from "@/src/components/layout/AppShell/AppShell";
import { Loading } from "@/src/components/ui/Notice/Notice";
import { SessionProvider } from "@/src/lib/session";

// URL hooks (usePathname/useParams) need a Suspense boundary with Cache Components.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <SessionProvider>
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </Suspense>
  );
}
