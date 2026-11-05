import type { Metadata } from "next";
import { Geist_Mono, Inter, Petrona } from "next/font/google";
import "./globals.css";
import { PRODUCT_NAME } from "@/lib/product";

// The type: Inter for text, the system display face (SF Pro on Apple devices) for admin headings,
// Petrona for help center headings, Geist Mono for code.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const petrona = Petrona({
  variable: "--font-petrona",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "A help center that keeps itself up to date, and the AI agent that writes it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${petrona.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
