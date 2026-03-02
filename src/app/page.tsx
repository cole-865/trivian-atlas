import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Trivian Atlas</h1>
      <p className="text-sm text-gray-600">You’re logged in.</p>
    </main>
  );
}