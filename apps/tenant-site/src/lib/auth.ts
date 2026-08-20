import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";

declare module "next-auth" {
  interface Session {
    tenant: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      userId: string; // landlord ID this tenant belongs to
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    tenantId: string;
    email: string;
    firstName: string;
    lastName: string;
    userId: string;
  }
}

export const tenantAuthOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Tenant Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // landlordUserId is passed to scope the login to a specific landlord
        landlordUserId: { label: "Landlord", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Find tenant scoped to the landlord
        const where: Record<string, unknown> = { email: credentials.email };
        if (credentials.landlordUserId) {
          where.userId = credentials.landlordUserId;
        }

        const tenant = await prisma.tenant.findFirst({ where });
        if (!tenant) return null;

        // Check lockout
        if (tenant.lockedUntil && tenant.lockedUntil > new Date()) {
          return null;
        }

        const valid = await bcrypt.compare(
          credentials.password,
          tenant.passwordHash
        );

        if (!valid) {
          // Increment failed attempts
          const attempts = tenant.failedLoginAttempts + 1;
          const lockout = attempts >= 5
            ? new Date(Date.now() + 15 * 60 * 1000) // 15 min lockout
            : null;

          await prisma.tenant.update({
            where: { id: tenant.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: lockout,
            },
          });

          return null;
        }

        // Reset failed attempts on success
        if (tenant.failedLoginAttempts > 0) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: { failedLoginAttempts: 0, lockedUntil: null },
          });
        }

        return {
          id: tenant.id,
          email: tenant.email,
          name: `${tenant.firstName} ${tenant.lastName}`,
          firstName: tenant.firstName,
          lastName: tenant.lastName,
          userId: tenant.userId,
        } as { id: string; email: string; name: string; firstName: string; lastName: string; userId: string };
      },
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.TENANT_AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { id: string; email: string; firstName: string; lastName: string; userId: string };
        token.tenantId = u.id;
        token.email = u.email;
        token.firstName = u.firstName;
        token.lastName = u.lastName;
        token.userId = u.userId;
      }
      return token;
    },
    async session({ session, token }) {
      session.tenant = {
        id: token.tenantId,
        email: token.email,
        firstName: token.firstName,
        lastName: token.lastName,
        userId: token.userId,
      };
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
