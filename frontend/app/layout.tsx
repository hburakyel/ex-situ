import "./globals.css"
import type React from "react"
import ClientMapLibreCSS from "@/components/client-maplibre-css"
import { Theme } from "@radix-ui/themes"
import AnalyticsScript from "@/components/analytics-script"
import { Noto_Sans_Mono } from "next/font/google"

// The map labels are Noto Sans Mono Regular (lib/protomaps-dark-style.ts); the
// interface uses the same open-licence (OFL) font, served from this site.
const notoSansMono = Noto_Sans_Mono({
  weight: "400",
  subsets: ["latin", "latin-ext", "greek", "cyrillic"],
  display: "swap",
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={notoSansMono.variable} suppressHydrationWarning>
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
        <AnalyticsScript />
      </body>
    </html>
  )
}

export const metadata = {
  metadataBase: new URL('https://exsitu.app'),
  title: 'Ex Situ',
  description: `A spatial index of displaced cultural artifacts — 
mapped from origin site to holding institution.`,
  openGraph: {
    title: 'Ex Situ',
    description: 'Explore the global spatial index of cultural artifacts. Browse provenance arcs by place, time, and collection on an interactive map.',
    url: 'https://exsitu.app',
    siteName: 'Ex Situ',
    type: 'website',
  },
  // Text-only link previews: no og:image by default. Pages with a real image
  // (artifacts) declare their own large-image card.
  twitter: {
    card: 'summary',
    title: 'Ex Situ',
    description: 'Explore the global spatial index of cultural artifacts. Browse provenance arcs by place, time, and collection on an interactive map.',
  },
};
