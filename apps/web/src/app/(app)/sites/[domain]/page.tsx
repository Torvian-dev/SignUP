import { api } from "@/lib/api";
import { SiteDetail, type SiteField } from "./SiteDetail";

export default async function SitePage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const d = decodeURIComponent(domain);
  const site = await api<{ domain: string; fields: SiteField[]; accounts: number }>(`/sites/${encodeURIComponent(d)}`);
  return <SiteDetail domain={site.domain} fields={site.fields} accounts={site.accounts} />;
}
