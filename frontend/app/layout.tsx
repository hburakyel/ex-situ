import "./globals.css"
import type React from "react"
import ClientMapLibreCSS from "@/components/client-maplibre-css"
import { Theme } from "@radix-ui/themes"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var observer = new MutationObserver(function(mutations) {
                  mutations.forEach(function(m) {
                    if (m.type === 'attributes' && m.attributeName === 'bis_skin_checked') {
                      m.target.removeAttribute('bis_skin_checked');
                    }
                  });
                });
                observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['bis_skin_checked'] });
              })();
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <Theme appearance="light" accentColor="gray" radius="large" scaling="100%" suppressHydrationWarning>
          <ClientMapLibreCSS />
          {children}
        </Theme>
      </body>
    </html>
  )
}

export const metadata = {
  metadataBase: new URL('https://exsitu.app'),
  title: 'Ex Situ',
  description: 'An open-source geospatial infrastructure that transforms institutional hyperlinks into a unified spatial index of cultural heritage provenance.',
  openGraph: {
    title: 'Ex Situ',
    description: 'An open-source geospatial infrastructure that transforms institutional hyperlinks into a unified spatial index of cultural heritage provenance.',
    url: 'https://exsitu.app',
    siteName: 'Ex Situ',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ex Situ',
    description: 'An open-source geospatial infrastructure that transforms institutional hyperlinks into a unified spatial index of cultural heritage provenance.',
  },
};
