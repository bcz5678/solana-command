import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RelayStatusIndicator } from "@/components/wss/relay-status-indicator";

async function UserDetails() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return JSON.stringify(data.claims, null, 2);
}

export default function ProtectedPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-12">
      <div className="w-full">
        <div className="bg-accent text-sm p-3 px-5 rounded-md text-foreground flex gap-3 items-center justify-between">
          Dashboard Home
          <RelayStatusIndicator />
        </div>
      </div> 
    </div>
  );
}
