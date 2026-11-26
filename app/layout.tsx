import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support Operations Console",
  description: "Human-centered review for AI-assisted support operations",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
