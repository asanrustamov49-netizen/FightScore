import { NextResponse, type NextRequest } from "next/server";

/** Pages anyone may open: start page, sign-in, judge and TV entry points, public display links. */
function isPublic(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/judge" || pathname === "/display" || pathname.startsWith("/display/");
}

/**
 * Optimistic redirect to /login when there is no session cookie at all.
 * This is NOT an authorization check: the backend verifies every request (docs/ARCHITECTURE.md §5.3).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  const hasSession = request.cookies.has("fs_session") || request.cookies.has("__Host-fs_session");
  if (hasSession) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // API proxy, Next internals and static files (sw.js, manifest, icons) never need the redirect.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
