"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { send } from "@/lib/utils";

const HEADERS = [
  "label", "firstName", "lastName", "email", "phone",
  "addressLine1", "addressLine2", "city", "region", "postcode", "country",
  "proxy",
  "custom:Date of Birth", "custom:Business Name",
];
const SAMPLE = [
  "John Smith,John,Smith,john.smith@example.com,07123456789,14 Park Row,,Leeds,West Yorkshire,LS1 5HD,GB,185.12.34.56:8080:user1:pass1,1985-03-07,Smith Engineering Ltd",
  "Sarah Jones,Sarah,Jones,sarah.jones@example.com,07933322211,2 King St,,Manchester,Greater Manchester,M1 2AB,GB,185.12.34.57:8080:user2:pass2,1990-06-14,Jones Design Co",
];

interface Result { created: number; failed: { row: number; label: string; error: string }[]; ids: string[] }

export function ImportCsv() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const template = HEADERS.join(",") + "\n" + SAMPLE.join("\n") + "\n";
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([template], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "profiles-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  const onFile = async (f: File | undefined) => { if (f) setCsv(await f.text()); };

  const doImport = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await send<Result>("/api/v1/profiles/import", "POST", { csv });
      setResult(r);
      if (r.created) router.refresh();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><Upload className="h-4 w-4" />Import CSV</Button>;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="imp-title" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <Card className="my-8 w-full max-w-2xl">
        <CardHeader>
          <CardTitle id="imp-title">Import profiles from CSV</CardTitle>
          <CardDescription>One row per profile. First row must be the column headers. Custom fields use a <code>custom:</code> prefix, e.g. <code>custom:Date of Birth</code>. The <code>proxy</code> column takes <code>ip:port:user:pass</code> (or <code>ip:port</code>). Each profile keeps its own proxy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="h-4 w-4" />Download template</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Choose a .csv file</Button>
          </div>
          <textarea
            aria-label="CSV content"
            className="h-56 w-full rounded-md border bg-transparent p-3 font-mono text-xs"
            placeholder={"label,firstName,lastName,email,phone,…\nJohn Smith,John,Smith,john@example.com,07123456789,…"}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {result && (
            <div className="rounded-md border p-3 text-sm">
              <p><span className="font-medium text-[var(--viz-good)]">{result.created} created</span>{result.failed.length > 0 && <span className="text-[var(--viz-warning)]">, {result.failed.length} skipped</span>}.</p>
              {result.failed.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {result.failed.map((f, i) => <li key={i}>Row {f.row}{f.label ? ` (${f.label})` : ""}: {f.error}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); setResult(null); setCsv(""); setError(null); }}>{result?.created ? "Done" : "Cancel"}</Button>
            <Button disabled={busy || !csv.trim()} onClick={doImport}>{busy ? "Importing…" : "Import"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
