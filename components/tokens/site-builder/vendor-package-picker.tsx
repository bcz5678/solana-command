"use client";

// ============================================================================
// components/vendor/VendorPackagePicker.tsx
//
// One list, two ingest paths.
//
// Catalogue entries and already-ingested packages appear together, with a state
// per row — someone looking for a font finds it whether or not anyone has
// ingested it yet, and ingesting is one click rather than a separate screen.
// Upload is the fallback for anything the catalogue doesn't cover, in the same
// surface.
//
// Reads list_vendor_packages, which FULL OUTER JOINs vendor_catalog with
// vendor_packages — so `in_catalog` and `versions.length` together describe
// which of three states a row is in.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// ============================================================================
// TYPES — mirror list_vendor_packages exactly
// ============================================================================

type DependencyKind = "stylesheet" | "script" | "font" | "iconset" | "polyfill";
type DependencyStrategy = "inline" | "copy" | "shared" | "external";

interface PackageVersion {
  version: string;
  fileCount: number;
  hasGlyphs: boolean;
  hasFaces: boolean;
  advisories: number;
}

interface VendorPackageRow {
  package_id: string;
  display_name: string;
  kind: DependencyKind;
  description: string | null;
  allowed_strategies: DependencyStrategy[];
  license_spdx: string | null;
  requires_attribution: boolean;
  deprecated: boolean;
  /** False when the catalogue has no source_url_template — upload is the only route. */
  can_fetch: boolean;
  in_catalog: boolean;
  versions: PackageVersion[];
}

type JobState =
  | { phase: "idle" }
  | { phase: "working"; packageId: string; note: string }
  | { phase: "error"; message: string };

export interface VendorPackagePickerProps {
  /** Selected `packageId@version` strings. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Narrow the list when a caller only wants one kind. */
  kind?: DependencyKind;
}

// ============================================================================
// PICKER
// ============================================================================

export function VendorPackagePicker({ value, onChange, kind }: VendorPackagePickerProps) {
  const [rows, setRows] = useState<VendorPackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [job, setJob] = useState<JobState>({ phase: "idle" });
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc("list_vendor_packages");

    if (error) setJob({ phase: "error", message: error.message });
    else setRows((data ?? []) as VendorPackageRow[]);

    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Ingest runs through n8n, so a row only changes when the callback lands.
  // Polling is cruder than a subscription but has no connection to keep alive
  // and no reconnect path to get wrong.
  useEffect(() => {
    if (job.phase !== "working") return;

    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [job.phase, load]);

  // Clear the working state once the version actually appears. There is no
  // "job finished" push — the row gaining a version IS the completion signal.
  useEffect(() => {
    if (job.phase !== "working") return;

    const row = rows.find((r) => r.package_id === job.packageId);
    if (row && row.versions.length > 0) setJob({ phase: "idle" });
  }, [rows, job]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();

    return rows
      .filter((row) => !kind || row.kind === kind)
      .filter((row) =>
        !term ||
        row.display_name.toLowerCase().includes(term) ||
        row.package_id.includes(term))
      // Installed first: picking something already there is the common case.
      .sort((a, b) => Number(b.versions.length > 0) - Number(a.versions.length > 0));
  }, [rows, query, kind]);

  const toggle = (packageId: string, version: string) => {
    const id = `${packageId}@${version}`;
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const startIngest = async (row: VendorPackageRow, version: string) => {
    setJob({ phase: "working", packageId: row.package_id, note: "Fetching upstream…" });

    // Curation comes from the catalogue row rather than the form — a catalogue
    // package's licence is known, which is exactly what distinguishes it from
    // an upload.
    const result = await postIngest({
      source: "registry",
      packageId: row.package_id,
      version,
      kind: row.kind,
      displayName: row.display_name,
      allowedStrategies: row.allowed_strategies,
      licenseSpdx: row.license_spdx ?? undefined,
      requiresAttribution: row.requires_attribution,
    });

    if ("error" in result) setJob({ phase: "error", message: result.error });
  };

  if (loading) return <p className="text-sm opacity-60">Loading packages…</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search packages"
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setShowUpload((s) => !s)}
          className="rounded border px-3 py-2 text-sm"
        >
          {showUpload ? "Cancel" : "Upload package"}
        </button>
      </div>

      {job.phase === "error" && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {job.message}
        </p>
      )}

      {job.phase === "working" && (
        <p className="rounded border bg-neutral-50 px-3 py-2 text-sm">
          Ingesting <span className="font-mono">{job.packageId}</span> — {job.note}
        </p>
      )}

      {showUpload && (
        <UploadPanel
          onQueued={(packageId) => {
            setShowUpload(false);
            setJob({ phase: "working", packageId, note: "Extracting…" });
          }}
          onError={(message) => setJob({ phase: "error", message })}
        />
      )}

      <ul className="divide-y rounded border">
        {visible.map((row) => (
          <PackageRow
            key={row.package_id}
            row={row}
            selected={value}
            busy={job.phase === "working" && job.packageId === row.package_id}
            onToggle={toggle}
            onIngest={(version) => void startIngest(row, version)}
          />
        ))}

        {visible.length === 0 && (
          <li className="px-3 py-6 text-center text-sm opacity-60">
            Nothing matches. Upload a package if it isn&apos;t in the catalogue.
          </li>
        )}
      </ul>
    </div>
  );
}

// ============================================================================
// ROW
// ============================================================================

function PackageRow({
  row, selected, busy, onToggle, onIngest,
}: {
  row: VendorPackageRow;
  selected: string[];
  busy: boolean;
  onToggle: (packageId: string, version: string) => void;
  onIngest: (version: string) => void;
}) {
  const [version, setVersion] = useState("");
  const installed = row.versions.length > 0;

  return (
    <li className="px-3 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {row.display_name}
            <Tag>{row.kind}</Tag>

            {/* Existing pins keep resolving; this only warns off new adoption. */}
            {row.deprecated && <Tag tone="warn">deprecated</Tag>}

            {/* No catalogue row means nobody can re-fetch it from source if the
                bytes are lost — worth showing. */}
            {!row.in_catalog && <Tag tone="muted">uploaded</Tag>}
          </p>

          {row.description && <p className="mt-0.5 text-xs opacity-70">{row.description}</p>}

          <p className="mt-0.5 text-xs opacity-60">
            {row.license_spdx ?? "licence unrecorded"}
            {row.requires_attribution && " · attribution required"}
            {" · "}
            {row.allowed_strategies.join(", ")}
          </p>
        </div>

        {/* Version box shows for a fetchable catalogue entry with nothing yet,
            and for adding a further version to something already installed. */}
        {row.can_fetch && (
          <div className="flex shrink-0 gap-2">
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="version"
              className="w-24 rounded border px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={!version.trim() || busy}
              onClick={() => onIngest(version.trim())}
              className="rounded border px-2 py-1 text-xs disabled:opacity-40"
            >
              {busy ? "Ingesting…" : installed ? "Add version" : "Ingest"}
            </button>
          </div>
        )}

        {!row.can_fetch && !installed && (
          <p className="shrink-0 text-xs opacity-60">upload only</p>
        )}
      </div>

      {installed && (
        <ul className="mt-2 space-y-1">
          {row.versions.map((v) => {
            const id = `${row.package_id}@${v.version}`;
            const blocked = v.advisories > 0;

            return (
              <li key={v.version}>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.includes(id)}
                    onChange={() => onToggle(row.package_id, v.version)}
                    // resolveDependency raises on an open advisory at or above
                    // the threshold, so selecting one guarantees a failed build.
                    disabled={blocked}
                  />
                  <span className="font-mono">{v.version}</span>
                  <span className="opacity-60">{v.fileCount} files</span>

                  {/* inline needs glyphs; without them resolveInline throws. */}
                  {v.hasGlyphs && <Tag tone="muted">glyphs</Tag>}
                  {/* Without faces, selectFiles cannot subset and every weight ships. */}
                  {v.hasFaces && <Tag tone="muted">faces</Tag>}
                  {blocked && <Tag tone="warn">{v.advisories} advisories</Tag>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

// ============================================================================
// UPLOAD
// ============================================================================

/**
 * Three steps, in this order:
 *
 *   1. POST /api/vendor/ingest        creates the job, returns a presigned PUT
 *   2. PUT  {uploadUrl}               browser → S3 directly
 *   3. POST /api/vendor/ingest/{id}/ready
 *
 * Job first, bytes second: a rejected job — version already ingested, or not a
 * super admin — fails before anything is uploaded, rather than leaving an
 * orphaned archive in the staging prefix.
 *
 * The archive never transits the app. A 40MB icon package through a Next route
 * would hit the body-size cap and hold the whole thing in memory to no purpose.
 */
function UploadPanel({
  onQueued, onError,
}: {
  onQueued: (packageId: string) => void;
  onError: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [packageId, setPackageId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [version, setVersion] = useState("");
  const [kind, setKind] = useState<DependencyKind>("font");
  const [strategies, setStrategies] = useState<DependencyStrategy[]>(["copy"]);
  // OFL-1.1 covers the overwhelming majority of uploads (fonts, iconsets) —
  // prefilling it turns the common case into "leave as-is" rather than a
  // required field every uploader has to remember to type.
  const [licenseSpdx, setLicenseSpdx] = useState("OFL-1.1");
  const [requiresAttribution, setRequiresAttribution] = useState(false);
  const [attributionText, setAttributionText] = useState("");
  const [noticeUrl, setNoticeUrl] = useState("");
  const [phase, setPhase] = useState<"idle" | "creating" | "uploading" | "dispatching">("idle");

  // Named so the disabled button can say *what's* missing instead of just
  // sitting there greyed out — licence in particular isn't visually marked
  // required and sits next to the optional Notice URL field, so "filled in
  // everything" and "ready" can silently disagree.
  const missing: string[] = [];
  if (!file) missing.push("archive file");
  if (!packageId.trim()) missing.push("package id");
  if (!displayName.trim()) missing.push("display name");
  if (!version.trim()) missing.push("version");
  if (!licenseSpdx.trim()) missing.push("licence (SPDX)");
  if (requiresAttribution && !attributionText.trim()) missing.push("attribution text");
  if (strategies.length === 0) missing.push("at least one allowed strategy");

  const ready = missing.length === 0;

  const submit = async () => {
    if (!file) return;

    try {
      setPhase("creating");

      const created = await postIngest({
        source: "upload",
        packageId: packageId.trim(),
        version: version.trim(),
        kind,
        displayName: displayName.trim(),
        allowedStrategies: strategies,
        licenseSpdx: licenseSpdx.trim(),
        requiresAttribution,
        attributionText: attributionText.trim() || undefined,
        noticeUrl: noticeUrl.trim() || undefined,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        contentLength: file.size,
      });

      if ("error" in created) { onError(created.error); setPhase("idle"); return; }
      if (!created.uploadUrl) { onError("no upload URL returned"); setPhase("idle"); return; }

      setPhase("uploading");

      // ContentType is signed into the presigned URL, so this header must match
      // what was sent at step 1 or S3 rejects the PUT with a signature error.
      const put = await fetch(created.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!put.ok) throw new Error(`upload failed (${put.status})`);

      setPhase("dispatching");

      const ready = await fetch(`/api/vendor/ingest/${created.jobId}/ready`, { method: "POST" });
      if (!ready.ok) {
        const payload = await ready.json().catch(() => ({}));
        throw new Error(payload.error ?? `dispatch failed (${ready.status})`);
      }

      onQueued(packageId.trim());
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div className="space-y-3 rounded border p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Package id" value={packageId} onChange={setPackageId} placeholder="my-font" required />
        <Field label="Display name" value={displayName} onChange={setDisplayName} placeholder="My Font" required />
        <Field label="Version" value={version} onChange={setVersion} placeholder="1.0.0" required />

        <label className="block text-xs">
          <span className="opacity-70">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DependencyKind)}
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          >
            {(["font", "iconset", "stylesheet", "script", "polyfill"] as const).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>

      {/* `external` is excluded: those packages store absolute URLs and upload
          nothing, so they are registered directly rather than ingested. */}
      <fieldset className="text-xs">
        <legend className="opacity-70">Allowed strategies</legend>
        <div className="mt-1 flex gap-3">
          {(["copy", "inline", "shared"] as const).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={strategies.includes(s)}
                onChange={() =>
                  setStrategies((prev) =>
                    prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
                }
              />
              {s}
            </label>
          ))}
        </div>
        {strategies.includes("inline") && kind !== "iconset" && (
          <p className="mt-1 text-amber-700">
            Inline is only implemented for iconsets — resolveInline will throw at build.
          </p>
        )}
      </fieldset>

      {/*
        Required here, unlike the catalogue path where the licence is known. An
        uploaded package's provenance rests entirely on whoever uploaded it, and
        it may end up on every customer domain — the cost of getting this wrong
        scales with reuse.
      */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Licence (SPDX)" value={licenseSpdx} onChange={setLicenseSpdx} placeholder="OFL-1.1" required />
        <Field label="Notice URL" value={noticeUrl} onChange={setNoticeUrl} placeholder="https://…" />
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={requiresAttribution}
          onChange={(e) => setRequiresAttribution(e.target.checked)}
        />
        Requires attribution
      </label>

      {requiresAttribution && (
        <Field
          label="Attribution text"
          value={attributionText}
          onChange={setAttributionText}
          placeholder="Icons by … — example.com"
        />
      )}

      <label className="block text-xs">
        <span className="opacity-70">
          Archive (.zip / .tgz)
          <span className="text-red-600"> *</span>
        </span>
        <input
          type="file"
          accept=".zip,.tgz,.tar.gz"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
      </label>

      <p className="text-xs opacity-60">
        The file list, glyphs and font faces are read from the archive after
        extraction — not from this form.
      </p>

      <button
        type="button"
        disabled={!ready || phase !== "idle"}
        onClick={submit}
        className="rounded border px-3 py-1.5 text-sm disabled:opacity-40"
      >
        {phase === "idle" ? "Upload and ingest"
          : phase === "creating" ? "Creating job…"
          : phase === "uploading" ? "Uploading…"
          : "Dispatching…"}
      </button>

      {phase === "idle" && missing.length > 0 && (
        <p className="text-xs text-amber-700">
          Missing: {missing.join(", ")}.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// SHARED
// ============================================================================

interface IngestRequest {
  source: "registry" | "upload";
  packageId: string;
  version: string;
  kind: DependencyKind;
  displayName: string;
  allowedStrategies: DependencyStrategy[];
  licenseSpdx?: string;
  requiresAttribution: boolean;
  attributionText?: string;
  noticeUrl?: string;
  filename?: string;
  contentType?: string;
  contentLength?: number;
}

async function postIngest(
  body: IngestRequest,
): Promise<{ jobId: string; uploadUrl?: string } | { error: string }> {
  const response = await fetch("/api/vendor/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    // 409 is the immutability rejection — a legitimate state, worth its own
    // wording rather than a generic failure.
    if (response.status === 409) {
      return {
        error: `${body.packageId}@${body.version} is already ingested. ` +
               `Versions are immutable — publish a new version instead.`,
      };
    }

    return {
      error: typeof payload.error === "string"
        ? payload.error
        : Array.isArray(payload.error)
          ? payload.error.map((i: { message: string }) => i.message).join("; ")
          : `Request failed (${response.status})`,
    };
  }

  return { jobId: payload.jobId as string, uploadUrl: payload.uploadUrl as string | undefined };
}

function Field({
  label, value, onChange, placeholder, required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs">
      <span className="opacity-70">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded border px-2 py-1 text-sm"
      />
    </label>
  );
}

function Tag({ children, tone = "default" }: {
  children: React.ReactNode;
  tone?: "default" | "muted" | "warn";
}) {
  const cls = tone === "warn"
    ? "bg-amber-100 text-amber-900"
    : tone === "muted"
      ? "bg-neutral-100 opacity-70"
      : "bg-neutral-100";

  return <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${cls}`}>{children}</span>;
}
