import "next-auth";

declare module "next-auth" {
  interface User {
    role: string;
    onboarded: boolean;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: string;
      onboarded: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    onboarded: boolean;
  }
}
