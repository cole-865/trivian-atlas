import { LoginPageClient } from "@/app/login/LoginPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LoginPage() {
  return <LoginPageClient />;
}
