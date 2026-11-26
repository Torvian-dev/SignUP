import { api } from "@/lib/api";
import { ProfileForm, type ProfileFormValues } from "./ProfileForm";
import { IdentityCheck } from "./IdentityCheck";

export default async function EditProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "new") return <ProfileForm />;
  const p = await api<any>(`/profiles/${id}`);
  const initial: ProfileFormValues = {
    label: p.label, firstName: p.personal.firstName ?? "", lastName: p.personal.lastName ?? "",
    email: p.personal.email ?? "", phone: p.personal.phone ?? "", locale: p.locale, timezone: p.timezone, isDefault: false,
    address: { kind: "primary", line1: "", line2: "", city: "", region: "", postcode: "", countryCode: "GB", ...(p.addresses.primary ?? {}) },
    proxyEnabled: !!p.proxy,
    proxy: p.proxy ? { type: p.proxy.type, host: p.proxy.host, port: p.proxy.port, username: p.proxy.username ?? "", password: "", credentialRotateDays: undefined }
                   : { type: "http", host: "", port: 8080, username: "", password: "" },
    customFields: Object.entries(p.custom).map(([key, f]: [string, any]) => ({ key, label: f.label, type: f.type, value: f.value ?? "", synonyms: (f.synonyms ?? []).join(", ") })),
  };
  return (
    <>
      <ProfileForm id={id} version={p.version} initial={initial} proxyPasswordSet={!!p.proxy?.passwordSet} />
      <IdentityCheck id={id} />
    </>
  );
}
