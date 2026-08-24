// types/grapesjs-fonts.d.ts
declare module '@silexlabs/grapesjs-fonts' {
  import type { Editor, Plugin } from 'grapesjs';

  /** Options accepted by the fonts plugin. */
  export interface GrapesJsFontsOptions {
    /** Google Fonts API key — required to populate the font picker. */
    api_key?: string;
    /** Label for the plugin's settings/dialog UI. */
    label?: string;
    /** i18n overrides, keyed by locale. */
    i18n?: Record<string, unknown>;
    /** Fonts preloaded into the manager on init. */
    fonts?: Array<{ name: string; value: string }>;
    /** Called after the plugin finishes registering commands. */
    onLoad?: (editor: Editor) => void;
  }

  const plugin: Plugin<GrapesJsFontsOptions>;
  export default plugin;
}