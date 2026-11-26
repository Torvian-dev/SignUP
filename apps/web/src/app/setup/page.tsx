import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { createFirstUser, needsSetup } from "@/lib/setup";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await needsSetup())) redirect("/login");
  const { error } = await searchParams;

  async function create(fd: FormData) {
    "use server";
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    const name = String(fd.get("name") ?? "");
    if (password !== confirm) redirect(`/setup?error=${encodeURIComponent("passwords do not match")}`);
    if (password.length < 12) redirect(`/setup?error=${encodeURIComponent("password must be at least 12 characters")}`);
    try {
      await createFirstUser({ email, name: name || undefined, password });
    } catch (e) {
      redirect(`/setup?error=${encodeURIComponent((e as Error).message)}`);
    }
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Create your account</CardTitle>
          <CardDescription>This is the first time Torv.io has run on this computer. Set up your owner account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" action={create}>
            <div className="space-y-1"><Label htmlFor="name">Your name (optional)</Label><Input id="name" name="name" autoComplete="name" /></div>
            <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="username" required /></div>
            <div className="space-y-1"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required /></div>
            <div className="space-y-1"><Label htmlFor="confirm">Confirm password</Label><Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required /></div>
            <p className="text-xs text-muted-foreground">At least 12 characters.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full">Create account &amp; sign in</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
