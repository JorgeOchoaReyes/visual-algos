/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Calm, neutral dark UI with a single violet accent.
        ink: "#0b0c10",
        panel: "#14161c",
        edge: "#262933",
        accent: "#8b7cff",
        accent2: "#f5a524",
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', "system-ui", "-apple-system", "Inter", "Roboto", "sans-serif"],
        mono: ['"Cascadia Code"', '"JetBrains Mono"', "Consolas", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        pixel: "0 16px 40px -12px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};
