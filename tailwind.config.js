/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 8-bit arcade palette
        ink: "#101226",
        panel: "#1a1d3a",
        edge: "#343a70",
        accent: "#7b6cff",
        accent2: "#ff5db1",
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
