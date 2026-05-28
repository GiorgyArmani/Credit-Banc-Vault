import './globals.css';
import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { FloatingSupport } from '@/components/floating-support'
import { ErrorDialogProvider } from '@/components/error-dialog'

export const metadata: Metadata = {
  title: 'Credit Banc Vault',
  description: 'Created to Keep your Credit information safe and secure.',
  generator: 'Credit Banc IT',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
      </head>
      <body className="bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <ErrorDialogProvider>
            {children}
            <FloatingSupport />
          </ErrorDialogProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
