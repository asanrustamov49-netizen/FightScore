import type { MetadataRoute } from "next";

/**
 * One window: launching the installed app again (its icon, a shortcut, or a link to this site while the app is
 * installed) brings the open window forward instead of opening a second copy. "focus-existing" keeps the current
 * screen (a judge mid-match does not lose the panel); PwaRegistration navigates only when a specific page was opened.
 * Browsers without launch_handler (Firefox, Safari) keep their own behaviour.
 */
type AppManifest = MetadataRoute.Manifest & { handle_links?: "preferred" | "auto" | "not-preferred" };

export default function manifest(): AppManifest {
  return {
    id: "/",
    launch_handler: { client_mode: ["focus-existing", "auto"] },
    // Links to this site open in the installed app (Chromium link capturing, where supported).
    handle_links: "preferred",
    name: "FightScore — судейство и табло",
    short_name: "FightScore",
    description: "Турниры, судейская панель и ТВ-табло для соревнований по единоборствам",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#07101f",
    theme_color: "#07101f",
    categories: ["sports", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Мои поединки", short_name: "Судья", url: "/judge", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Открыть табло", short_name: "Табло", url: "/display", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Панель организатора", short_name: "Панель", url: "/dashboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
