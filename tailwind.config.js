/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 8-bit / cyberpunk neon palette
        ink: "#080611",
        panel: "#150f2b",
        edge: "#382d63",
        accent: "#22e6ff",
        accent2: "#ff3ca6",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ['"Courier New"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        pixel: "4px 4px 0 0 rgba(0,0,0,0.55)",
      },
    },
  },
  plugins: [],
};
