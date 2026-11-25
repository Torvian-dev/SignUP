declare module "next-auth/jwt" { interface JWT { uid?: string; at?: string; rt?: string; exp_at?: number; org?: string; error?: string } }
export {};
