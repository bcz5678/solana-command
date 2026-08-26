// types/grapesjs-fonts.d.ts
declare module 'grapejs-tabs' {
  import type { Editor, Plugin } from 'grapesjs';

  /** Options accepted by the fonts plugin. */
  export interface GrapesJsTabsOptions {
    
    /** Called after the plugin finishes registering commands. */
    onLoad?: (editor: Editor) => void;
  }

  const plugin: Plugin<GrapesJsFontsOptions>;
  export default plugin;
}