import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui";

export default async function NewRunPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { data: profiles } = await api<{ data: { id: string; label: string; isDefault: boolean }[] }>("/profiles");

  async function start(fd: FormData) {
    "use server";
    let runId: string;
    try {
      const run = await api<{ id: string }>("/runs", { method: "POST", body: JSON.stringify({ url: fd.get("url"), profileId: fd.get("profileId"), intent: fd.get("intent") }) });
      runId = run.id;
    } catch (e) {
      redirect(`/runs/new?error=${encodeURIComponent((e as Error).message)}`);
    }
    redirect(`/runs/${runId}`);
  }

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New automation</CardTitle>
          <CardDescription>The agent opens the site, finds the form, fills it from your profile and stops for your review before anything is submitted.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={start} className="space-y-4">
            <div className="space-y-1"><Label htmlFor="url">Website URL</Label><Input id="url" name="url" type="url" required placeholder="https://supplier-portal.example.com/register" /></div>
            <div className="space-y-1"><Label htmlFor="profileId">Profile</Label>
              <select id="profileId" name="profileId" required className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" defaultValue={profiles.find((p) => p.isDefault)?.id}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select></div>
            <div className="space-y-1"><Label htmlFor="intent">What should the agent do?</Label>
              <select id="intent" name="intent" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" defaultValue="auto">
                <option value="auto">Detect automatically</option><option value="signup">Create an account</option><option value="login">Sign in (existing account)</option>
                <option value="application">Complete an application</option><option value="onboarding">Complete onboarding</option><option value="contact">Contact / enquiry form</option>
              </select></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full">Start agent</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
