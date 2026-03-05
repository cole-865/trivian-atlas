import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  redirect("/home");
}