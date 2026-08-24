"use client";

// ============================================================================
// app/protected/tokens/vendor-registry/client.tsx
//
// No consumer for the selection yet — this proves the round trip
// (catalogue/ingest/upload -> selected packageId@version strings) rather
// than wiring it into a manifest editor that doesn't exist here.
// ============================================================================

import { useState } from "react";
import { VendorPackagePicker } from "@/components/tokens/site-builder/vendor-package-picker";

export function VendorRegistryClient() {
  const [value, setValue] = useState<string[]>([]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Vendor package registry</h1>
        <p className="text-sm text-muted-foreground">
          Ingest packages from the catalogue or upload an archive directly.
        </p>
      </header>

      <VendorPackagePicker value={value} onChange={setValue} />

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Selected</p>
        <pre className="overflow-auto rounded border bg-neutral-50 p-3 text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    </div>
  );
}
