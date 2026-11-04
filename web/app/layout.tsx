import type { Metadata } from "next";
import { JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: "obligations-agent",
  description: "An obligations memo for one AI product under the EU AI Act and the GDPR.",
};

// The two fonts of the design, which the web app serves itself. globals.css names their variables
// first in --font-text and --font-label.
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Every screen: a header with the product name, which links to the start page, and the content in
// one column.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`}>
      <body>
        <header className={styles.header}>
          <Link href="/" className={styles.name}>
            obligations-agent
          </Link>
        </header>
        <main className={styles.main}>{children}</main>
      </body>
    </html>
  );
}
