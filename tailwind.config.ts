import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#141414",
        panel2: "#1c1c1c",
        accent: "#c8ff3e",
        offwhite: "#f6f5f2",
      },
    },
  },
  plugins: [],
};

export default config;
