import Link from "next/link";
import { api } from "@/lib/api";
import { ImportCsv } from "./ImportCsv";
import { ProfilesTable, type ProfileRow } from "./ProfilesTable";

export default async function ProfilesPage() {
  const { data } = await api<{ data: ProfileRow[] }>("/profiles");
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div><h1 className="text-2xl font-semibold">Profiles</h1><p className="text-sm text-muted-foreground">Enter your details once; every automation reuses them. One proxy per profile. Tick profiles to edit them in bulk.</p></div>
        <div className="flex gap-2"><ImportCsv /><Link href="/profiles/new" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">New profile</Link></div>
      </div>
      <ProfilesTable data={data} />
    </div>
  );
}
