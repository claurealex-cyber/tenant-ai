import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;

    // Redirect non-onboarded users to onboarding
    // Allow billing pages so they can choose a plan first
    if (
      token &&
      !token.onboarded &&
      !req.nextUrl.pathname.startsWith("/onboarding") &&
      !req.nextUrl.pathname.startsWith("/billing") &&
      !req.nextUrl.pathname.startsWith("/api/")
    ) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - Auth pages (login, signup, forgot-password)
     * - API auth routes
     * - Static files and Next.js internals
     */
    "/((?!login|signup|forgot-password|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
