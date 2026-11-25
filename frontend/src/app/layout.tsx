import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tenxcalender",
  description: "An AI-native calendar manager: state an intent, review the plan, apply.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
