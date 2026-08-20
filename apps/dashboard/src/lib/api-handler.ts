import { NextRequest, NextResponse } from "next/server";

type RouteHandler = (
  request: NextRequest,
  context: any
) => Promise<NextResponse>;

/**
 * Wraps an API route handler with try/catch to ensure JSON error responses.
 */
export function apiHandler(fn: RouteHandler): RouteHandler {
  return async (request: NextRequest, context: any) => {
    try {
      return await fn(request, context);
    } catch (err) {
      console.error("API route error:", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
