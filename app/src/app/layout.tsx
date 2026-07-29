import type { Metadata } from "next";
import "../app.css";

export const metadata: Metadata = {
  title: "InstaMosaic",
  description: "Turn public Instagram posts into print-ready photo mosaics."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
