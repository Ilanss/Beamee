/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./renderer/**/*.{html,js}"],
  theme: {
    extend: {},
  },
  plugins: [
    require("@tailwindcss/typography"),
    require('daisyui'),
  ],
}

