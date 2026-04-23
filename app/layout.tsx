import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "StackPress",
  description: "Self-Hosted WordPress Stack Manager"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
