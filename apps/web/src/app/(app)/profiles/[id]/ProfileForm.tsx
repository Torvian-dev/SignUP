"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { send } from "@/lib/utils";
import { parseProxyString } from "@/lib/proxy";

export interface ProfileFormValues {
  label: string; firstName: string; lastName: string; email: string; phone: string; locale: string; timezone: string; isDefault: boolean;
  address: { kind: "primary"; line1: string; line2: string; city: string; region: string; postcode: string; countryCode: string };
  proxyEnabled: boolean;
  proxy: { type: "http" | "https" | "socks5"; host: string; port: number; username: string; password: string; credentialRotateDays?: number };
  customFields: { key: string; label: string; type: string; value: string; synonyms: string }[];
}

const EMPTY: ProfileFormValues = {
  label: "", firstName: "", lastName: "", email: "", phone: "", locale: "en-GB", timezone: "Europe/London", isDefault: false,
  address: { kind: "primary", line1: "", line2: "", city: "", region: "", postcode: "", countryCode: "GB" },
  proxyEnabled: false, proxy: { type: "http", host: "", port: 8080, username: "", password: "" },
  customFields: [],
};

const SUGGESTED = [
  { label: "Date of Birth", key: "date_of_birth", type: "date" },
  { label: "Username", key: "username", type: "text" },
  { label: "Business Name", key: "business_name", type: "text" },
  { label: "Company Number", key: "company_number", type: "text" },
  { label: "VAT / Tax ID", key: "tax_id", type: "secret" },
  { label: "LinkedIn URL", key: "linkedin_url", type: "url" },
  { label: "Passport Number", key: "passport_number", type: "secret" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/^(\d)/, "f_$1").slice(0, 63) || "field";

export function ProfileForm({ id, version, initial, proxyPasswordSet }: { id?: string; version?: number; initial?: ProfileFormValues; proxyPasswordSet?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm<ProfileFormValues>({ defaultValues: initial ?? EMPTY });
  const custom = useFieldArray({ control, name: "customFields" });
  const proxyEnabled = watch("proxyEnabled");

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const body = {
      label: v.label, firstName: v.firstName || undefined, lastName: v.lastName || undefined, email: v.email || undefined, phone: v.phone || undefined,
      locale: v.locale, timezone: v.timezone, isDefault: v.isDefault,
      addresses: v.address.line1 || v.address.postcode ? [{ ...v.address, line2: v.address.line2 || undefined }] : [],
      proxy: v.proxyEnabled ? { ...v.proxy, port: Number(v.proxy.port), username: v.proxy.username || undefined, password: v.proxy.password || undefined,
                               credentialRotateDays: v.proxy.credentialRotateDays ? Number(v.proxy.credentialRotateDays) : undefined } : null,
      customFields: v.customFields.map((f) => ({ key: f.key || slug(f.label), label: f.label, type: f.type, value: f.value || undefined,
                                                  synonyms: f.synonyms.split(",").map((s) => s.trim()).filter(Boolean) })),
    };
    try {
      if (id) await send(`/api/v1/profiles/${id}`, "PUT", { ...body, version });
      else await send(`/api/v1/profiles`, "POST", body);
      router.push("/profiles");
      router.refresh();
    } catch (e) { setError((e as Error).message); }
  });

  const field = (name: any, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1"><Label htmlFor={name}>{label}</Label><Input id={name} {...register(name)} {...props} /></div>
  );

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{id ? "Edit profile" : "New profile"}</h1>

      <Card><CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("label", "Profile name", { required: true, placeholder: "Profile A – John Smith" })}
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" {...register("isDefault")} /> Default profile</label>
        </CardContent></Card>

      <Card><CardHeader><CardTitle>Personal information</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("firstName", "First name", { autoComplete: "off" })}
          {field("lastName", "Last name", { autoComplete: "off" })}
          {field("email", "Email address", { type: "email", autoComplete: "off" })}
          {field("phone", "Phone number", { type: "tel", autoComplete: "off" })}
        </CardContent></Card>

      <Card><CardHeader><CardTitle>Address</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("address.line1", "Address line 1")}
          {field("address.line2", "Address line 2")}
          {field("address.city", "City")}
          {field("address.region", "County / State")}
          {field("address.postcode", "Postcode / ZIP")}
          {field("address.countryCode", "Country (ISO code, e.g. GB)", { maxLength: 2 })}
        </CardContent></Card>

      <Card>
        <CardHeader><CardTitle>Proxy</CardTitle><CardDescription>One proxy per profile. Every run for this profile uses it, so the site always sees the same connection.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("proxyEnabled")} /> Route this profile through a proxy</label>
          {proxyEnabled && (
            <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="proxyPaste">Paste proxy (ip:port:user:pass)</Label>
              <Input id="proxyPaste" placeholder="185.12.34.56:8080:user:pass" autoComplete="off"
                onChange={(e) => {
                  const p = parseProxyString(e.target.value);
                  if (!p) return;
                  setValue("proxy.type", p.type); setValue("proxy.host", p.host); setValue("proxy.port", p.port);
                  if (p.username !== undefined) setValue("proxy.username", p.username);
                  if (p.password !== undefined) setValue("proxy.password", p.password);
                }} />
              <p className="text-xs text-muted-foreground">Fills the fields below. Also accepts ip:port, user:pass@ip:port and scheme:// prefixes.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="ptype">Proxy type</Label>
                <select id="ptype" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" {...register("proxy.type")}>
                  <option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option>
                </select></div>
              {field("proxy.host", "Proxy host", { placeholder: "gb.proxy.example.com" })}
              {field("proxy.port", "Proxy port", { type: "number", min: 1, max: 65535 })}
              {field("proxy.username", "Proxy username", { autoComplete: "off" })}
              {field("proxy.password", proxyPasswordSet ? "Proxy password (leave blank to keep)" : "Proxy password", { type: "password", autoComplete: "new-password" })}
              {field("proxy.credentialRotateDays", "Remind to rotate credentials every (days)", { type: "number", min: 1, max: 365 })}
            </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Custom fields</CardTitle><CardDescription>Add as many as you need. Synonyms help the AI recognise the field on other sites.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {custom.fields.map((f, i) => (
            <div key={f.id} className="grid items-end gap-2 sm:grid-cols-[1fr_7rem_1fr_1fr_auto]">
              <div className="space-y-1"><Label>Label</Label><Input {...register(`customFields.${i}.label`, { required: true })} /></div>
              <div className="space-y-1"><Label>Type</Label>
                <select className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" {...register(`customFields.${i}.type`)}>
                  {["text", "date", "number", "email", "phone", "url", "secret"].map((t) => <option key={t}>{t}</option>)}
                </select></div>
              <div className="space-y-1"><Label>Value</Label><Input type={watch(`customFields.${i}.type`) === "secret" ? "password" : "text"} autoComplete="off" {...register(`customFields.${i}.value`)} /></div>
              <div className="space-y-1"><Label>Synonyms</Label><Input placeholder="DOB, Birthday" {...register(`customFields.${i}.synonyms`)} /></div>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove field" onClick={() => custom.remove(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.filter((s) => !custom.fields.some((f) => f.key === s.key)).map((s) => (
              <Button key={s.key} type="button" variant="outline" size="sm" onClick={() => custom.append({ ...s, value: "", synonyms: "" })}><Plus className="h-3 w-3" />{s.label}</Button>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => custom.append({ key: "", label: "", type: "text", value: "", synonyms: "" })}><Plus className="h-3 w-3" />Custom field</Button>
          </div>
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save profile"}</Button>
      </div>
    </form>
  );
}
