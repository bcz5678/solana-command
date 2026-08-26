'use client';

import { useEffect, useRef } from 'react';
import 'grapesjs/dist/css/grapes.min.css';

export default function GrapesJSPageBuilder() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    // Guard: effects only run client-side, but this makes intent explicit
    // and protects against any future non-effect call path.
    if (typeof window === 'undefined' || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      // Dynamic imports — evaluated only in the browser, so the UMD
      // wrapper's top-level `document` reference is safe.
      const [
        { default: grapesjs }, 
        { default: gjsFonts },
        { default: webpagePlugin },
        { default: gjsBlocksBasic },
        { default: gjsForms },
        { default: gjsNavbar },
        { default: gjsBlocksFlexbox },
        { default: gjsExportZip },
        { default: gjsStyleBg },
        { default: gjsCustomCode },
        //{ default: gjsTabs },
        { default: gjsStyleGradient },
        { default: gjsTemplates },
      ] = await Promise.all([
        import('grapesjs'),
        import('@silexlabs/grapesjs-fonts'),
        import('grapesjs-preset-webpage'),
        import('grapesjs-blocks-basic'),
        import('grapesjs-plugin-forms'),
        import('grapesjs-navbar'),
        import('grapesjs-blocks-flexbox'),
        import('grapesjs-plugin-export'),
        import('grapesjs-style-bg'),
        import('grapesjs-custom-code'),
        //import('grapesjs-tabs'),
        import('grapesjs-style-gradient'),
        import('grapesjs-templates'),
      ]);

      // Bail if the component unmounted while the chunks were loading
      if (cancelled) return;

      const editor = grapesjs.init({
        container: containerRef.current!,
        height: '100vh',
         storageManager: {
          type: "local", // Storage type. Available: local | remote
          autosave: true, // Store data automatically
          autoload: true, // Autoload stored data on init
          stepsBeforeSave: 20
        },
        plugins: [
          gjsFonts,
          webpagePlugin,
          gjsBlocksBasic,
          gjsForms,
          gjsNavbar,
          gjsBlocksFlexbox,
          gjsExportZip,
          gjsStyleBg,
          gjsCustomCode,
          //gjsTabs,
          gjsStyleGradient,
          gjsTemplates,
        ],
        pluginsOpts: {
          [gjsFonts as any]: {
            api_key: process.env.NEXT_PUBLIC_GOOGLE_FONTS_KEY,
          },
          [gjsExportZip as any]: {
            addExportBtn: true,
            btnLabel: "Export to ZIP",
          },
          gjsStyleBgOpts: {
            'grapesjs-style-bg': {},
          },
        },
      });

      // What panels actually exist on this build?
      console.log('panels:', editor.Panels.getPanels().map((p: any) => p.get('id')));

      editorRef.current = editor;

    
      const fontBtn = editor.Panels.addButton('options', {
        id: 'open-fonts',
        className: 'fa fa-font',
        command: 'open-fonts',
        attributes: { title: 'Open font dialog' },
      });

      const exportBtn = editor.Panels.addButton('options', {
        id: 'export-zip',
        className: 'fa fa-file',
        command: 'gjs-export-zip',
        attributes: { title: 'Export as ZIP' },
      });


      // addButton returns null/undefined when the target panel doesn't exist —
    // it fails silently, which is why you get no error and no button.
    console.log('addButton returned:', fontBtn);
    console.log('addButton returned:', exportBtn);
    })();

    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, []);

  return <div ref={containerRef} />;
}


