import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "obligations-agent",
  description: "An obligations memo for one AI product under the EU AI Act and the GDPR.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
