import type { Metadata, Viewport } from "next";
import { DEFAULT_PREFERENCES, PREFERENCES_SCRIPT, PreferencesSync } from "@/src/lib/preferences";
import { PwaRegistration } from "@/src/lib/pwa";
import "./globals.scss";

export const metadata: Metadata = {
  title: { default: "FightScore", template: "%s · FightScore" },
  description: "Управление соревнованиями по единоборствам: турниры, судейство, табло",
  applicationName: "FightScore",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "FightScore", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2f8" },
    { media: "(prefers-color-scheme: dark)", color: "#07101f" },
  ],
};

// The inline script sets the saved theme before the first paint (docs: guides/preventing-flash-before-hydration).
// suppressHydrationWarning: the script changes <html> attributes before React hydrates.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      data-theme={DEFAULT_PREFERENCES.theme}
      data-bg={DEFAULT_PREFERENCES.bg}
      data-density={DEFAULT_PREFERENCES.density}
      data-motion={DEFAULT_PREFERENCES.motion}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_SCRIPT }} />
      </head>
      <body>
        {children}
        <PreferencesSync />
        <PwaRegistration />
      </body>
    </html>
  );
}
