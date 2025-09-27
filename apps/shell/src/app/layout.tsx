import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { OfflineProvider } from "@/components/OfflineProvider";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { ExtensionProvider } from "@/components/ExtensionProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bobbinry Shell",
  description: "Modular platform for writers and worldbuilders",
  manifest: "/manifest.json",
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <OfflineProvider>
          <ExtensionProvider>
            {children}
            <OfflineIndicator />
          </ExtensionProvider>
        </OfflineProvider>
      </body>
    </html>
  );
}
