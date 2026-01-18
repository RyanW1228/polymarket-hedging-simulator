// frontend/app/layout.tsx

import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Correl v1",
  description: "Correlation-aware tournament hedging",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          backgroundColor: "white",
          color: "black",
          margin: 0,
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
