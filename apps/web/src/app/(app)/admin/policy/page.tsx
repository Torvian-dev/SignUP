import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui";

export default async function PolicyPage() {
  const p = await api<any>("/analytics/policy");

  async function save(fd: FormData) {
    "use server";
    await api("/analytics/policy", { method: "PUT", body: JSON.stringify({
      requireReviewEveryStep: fd.get("requireReviewEveryStep") === "on",
      allowAutoSubmit: fd.get("allowAutoSubmit") === "on",
      captchaSolvingEnabled: fd.get("captchaSolvingEnabled") === "on",
      captchaMaxSpendDailyUsd: Number(fd.get("captchaMaxSpendDailyUsd")),
      maxRunsPerDomainPerDay: Number(fd.get("maxRunsPerDomainPerDay")),
      maxConcurrentRuns: Number(fd.get("maxConcurrentRuns")),
      autoAcceptConfidence: Number(fd.get("autoAcceptConfidence")),
    }) });
    revalidatePath("/admin/policy");
  }

  return (
    <form action={save} className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Policy & guardrails</h1>
      <Card>
        <CardHeader><CardTitle>Review</CardTitle><CardDescription>Final submissions (Submit, Register, Create account, Apply, Pay) always need a person's approval.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requireReviewEveryStep" defaultChecked={p.require_review_every_step} />Also stop for review on every “Next / Continue” step</label>
          <div className="space-y-1"><Label htmlFor="aac">Auto-advance only when every required field is at least this confident</Label>
            <Input id="aac" name="autoAcceptConfidence" type="number" step="0.01" min="0.7" max="0.99" defaultValue={p.auto_accept_confidence} /></div>
        </CardContent>
      </Card>
      <Card className="border-[var(--viz-warning)]">
        <CardHeader><CardTitle>Automatic submission (batch sign-ups)</CardTitle>
          <CardDescription>Off by default. When on, a batch run submits each account without a review click, and solves CAPTCHAs through your configured providers. A profile is skipped (not guessed) if a required field is uncertain or a CAPTCHA can&apos;t be solved. One account per profile per site still applies.</CardDescription></CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowAutoSubmit" defaultChecked={p.allow_auto_submit} />Allow batches to submit automatically on this organisation&apos;s behalf</label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>CAPTCHA</CardTitle><CardDescription>When off, or when the daily budget is spent, challenges go to the reviewer's live view.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="captchaSolvingEnabled" defaultChecked={p.captcha_solving_enabled} />Route CAPTCHAs to configured solving providers</label>
          <div className="space-y-1"><Label htmlFor="spend">Daily spend cap (USD)</Label><Input id="spend" name="captchaMaxSpendDailyUsd" type="number" step="0.5" min="0" defaultValue={p.captcha_max_spend_daily_usd} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Rate limits</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="perdomain">Runs per website per day</Label><Input id="perdomain" name="maxRunsPerDomainPerDay" type="number" min="1" max="200" defaultValue={p.max_runs_per_domain_per_day} /></div>
          <div className="space-y-1"><Label htmlFor="conc">Concurrent runs</Label><Input id="conc" name="maxConcurrentRuns" type="number" min="1" max="50" defaultValue={p.max_concurrent_runs} /></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Each profile can hold one account per website; a repeat sign-up becomes a sign-in.</p>
        </CardContent>
      </Card>
      <div className="flex justify-end"><Button>Save policy</Button></div>
    </form>
  );
}
