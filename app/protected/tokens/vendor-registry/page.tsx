import { requireSuperAdminPage } from "@/lib/auth/require-super-admin";
import { VendorRegistryClient } from "./client";

// ============================================================================
// app/protected/tokens/vendor-registry/page.tsx
//
// list_vendor_packages (called by VendorPackagePicker) is granted to
// `authenticated`, not to super admins specifically — the RPC itself does
// not stop a signed-in, non-admin user from reading the catalogue. This
// route is what does: requireSuperAdminPage() checks is_super_admin() and
// redirects before VendorRegistryClient — and therefore the picker — ever
// renders.
// ============================================================================

export default async function VendorRegistryPage() {
  await requireSuperAdminPage();

  return <VendorRegistryClient />;
}
