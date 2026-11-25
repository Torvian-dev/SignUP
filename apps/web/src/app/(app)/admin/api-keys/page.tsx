import { api } from "@/lib/api";
import { ApiKeysManager } from "./ApiKeysManager";

export default async function ApiKeysPage() {
  const [{ data }, catalog] = await Promise.all([
    api<{ data: any[] }>("/providers"),
    api<Record<string, string[]>>("/providers/catalog"),
  ]);
  return <ApiKeysManager initial={data} catalog={catalog} />;
}
