import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { EnvValidationBanner } from "@/components/shell/EnvValidationBanner";
import { FooterBar } from "@/components/shell/FooterBar";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Hotel Siddhi Vinayak — AI Operating System",
  description: "Autonomous AI departments running revenue, website, SEO and analytics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-bg font-sans text-text antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <EnvValidationBanner />
            <main className="flex-1 overflow-x-hidden p-6">{children}</main>
            <FooterBar />
          </div>
        </div>
      </body>
    </html>
  );
}
