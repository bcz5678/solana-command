'use client';

import dynamic from 'next/dynamic';

const GrapesJsPageBuilder = dynamic(
  () => import('@/components/dev/grapesjs-page-builder'),
  {
    ssr: false,
    loading: () => <div className="h-screen animate-pulse bg-neutral-100" />,
  }
);

export default function Page() {
  return <GrapesJsPageBuilder />;
}