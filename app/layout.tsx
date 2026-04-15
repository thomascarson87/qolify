import type { Metadata } from "next";
import { Playfair_Display, DM_Sans, DM_Mono } from "next/font/google";
import { NO_FOUC_SCRIPT } from "@/lib/theme";
import { TopNav } from "@/components/ui/TopNav";
import "./globals.css";

// Editorial serif — page titles, section headers, italic callouts
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
});

// UI sans — body, labels, buttons, navigation
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Monospace — prices, scores, data labels
const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Qolify — Property Intelligence for Spain",
  description:
    "See what Idealista won't tell you. Flood risk, true monthly cost, building health, school proximity and more — before you buy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${dmSans.variable} ${dmMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* Runs synchronously before first paint — eliminates the flash of light theme on dark-preference page loads */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FOUC_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
