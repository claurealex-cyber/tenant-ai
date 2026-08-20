import NextAuth from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";

const handler = NextAuth(tenantAuthOptions);
export { handler as GET, handler as POST };
