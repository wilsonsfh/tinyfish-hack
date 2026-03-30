import type { Metadata } from "next"
import { Inter, EB_Garamond } from "next/font/google"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "DriftCheck",
  description: "Personal AI assistant for keeping agentic-tool skills, references, dependencies, and repo conventions current.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${ebGaramond.variable} h-full antialiased`}
    >
      <body className="font-sans font-light selection:bg-stone-200/50 selection:text-black">
        {children}
      </body>
    </html>
  )
}
