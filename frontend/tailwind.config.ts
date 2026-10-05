import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1B2430",
        slate: {
          850: "#1F2A38",
        },
        paper: "#F7F5F0",
        chalk: "#E8E4D9",
        board: "#233240",
        accent: {
          DEFAULT: "#3B6E5E",
          light: "#5C8F7C",
          dark: "#26483D",
        },
        warn: "#B8622C",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(27,36,48,0.06), 0 8px 24px rgba(27,36,48,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
