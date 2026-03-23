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
  title: 'Ex Situ — Relational Spatial Index',
  description: 'An open-source geospatial infrastructure that transforms institutional hyperlinks into a unified spatial index of cultural heritage provenance.',
};
