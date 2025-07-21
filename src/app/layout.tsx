import type React from "react"
import { Inter } from "next/font/google"
import "./globals.css"
import Script from "next/script"

const inter = Inter({ subsets: ["latin", "cyrillic"] })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru">
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
