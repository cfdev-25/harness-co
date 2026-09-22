import type { Metadata } from "next";
import { HomePage } from "./home";
import { PublicTheme } from "./public-theme";

export const metadata: Metadata = {
  title: "Harness",
  description:
    "A harness-agnostic management and collaboration solution for preserving, iterating, and proliferating agentic work across your organization.",
};

export default function Home() {
  return (
    <PublicTheme>
      <HomePage />
    </PublicTheme>
  );
}
