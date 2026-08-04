import { TemplateManifest } from "@/site-platform/schema"; 

export interface TemplateListEntry {
  id: string;
  name: string;
  description: string;
  previewImage: string | null;
  version: string;
  rendererKey: string;
  kind: TemplateManifest["kind"];
  manifest: TemplateManifest;
}