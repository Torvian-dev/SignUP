import { signIn } from "@/auth";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle className="text-lg">Sign in to FormAgent</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/dashboard" }); }}>
            <Button variant="outline" className="w-full">Continue with Microsoft</Button>
          </form>
          <form action={async () => { "use server"; await signIn("google", { redirectTo: "/dashboard" }); }}>
            <Button variant="outline" className="w-full">Continue with Google</Button>
          </form>
          <div className="text-center text-xs text-muted-foreground">or</div>
          <form className="space-y-3" action={async (fd) => { "use server"; await signIn("credentials", { email: fd.get("email"), password: fd.get("password"), totp: fd.get("totp"), redirectTo: "/dashboard" }); }}>
            <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="username" required /></div>
            <div className="space-y-1"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <div className="space-y-1"><Label htmlFor="totp">Authenticator code (if enabled)</Label><Input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" /></div>
            <Button className="w-full">Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
