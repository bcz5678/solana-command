import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let admin
  try {
    ({ admin } = await requireSuperAdmin())
  } catch (e) {
    return e as Response
  }

  const { userId, role } = await request.json();

  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
