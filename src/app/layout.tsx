import './globals.css';
import type { Metadata } from 'next'
import { Manrope, Inter } from 'next/font/google'
import { FloatingSupport } from '@/components/floating-support'
import { ErrorDialogProvider } from '@/components/error-dialog'

// Self-hosted + preloaded, so there is no render-blocking Google Fonts request
// and no FOUT. The variables are consumed by theme.fontFamily in tailwind.config.ts.
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Credit Banc Vault',
  description: 'Created to Keep your Credit information safe and secure.',
  generator: 'Credit Banc IT',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${inter.variable}`}>
      <head>
        {/* Material Symbols is still referenced by a handful of advisor/admin
            screens. Remove this link once those spans are migrated to lucide. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
      </head>
      {/* No next-themes ThemeProvider. It renders a literal <script> element
          inside a client component, which React 19.2 warns about on every
          route ("Encountered a script tag while rendering React component").
          The library has no opt-out — its ThemeScript is unconditional — and
          0.4.6 is already latest, so there is nothing to upgrade to.

          Dropping it is behavior-neutral here: defaultTheme was "light", the
          only useTheme() consumer is theme-switcher.tsx, and that component is
          imported by src/app/page.tsx but never rendered. No visitor could
          reach dark mode, so the app was light-only in practice already.

          To bring theming back, restore <ThemeProvider> around the children
          and mount ThemeSwitcher somewhere — the ~100 `dark:` variants still
          in the tree will start resolving again, and the warning with them. */}
      <body className="bg-background text-foreground">
        <ErrorDialogProvider>
          {children}
          <FloatingSupport />
        </ErrorDialogProvider>
      </body>
    </html>
  )
}
