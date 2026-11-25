import Link from "next/link";
import { api } from "@/lib/api";
import { BatchForm } from "./BatchForm";

export default async function NewBatchPage() {
  const [{ data: profiles }, policy] = await Promise.all([
    api<{ data: { id: string; label: string; displayName: string; proxy: { host: string } | null }[] }>("/profiles"),
    api<{ allow_auto_submit: boolean }>("/analytics/policy"),
  ]);
  return <BatchForm profiles={profiles} autoSubmitEnabled={policy.allow_auto_submit} />;
}
