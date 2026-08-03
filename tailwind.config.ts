import type { Config } from "tailwindcss"

const config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "#55cf9e", // Main primary color
          50: "#f0fdf7",
          100: "#dcfce8",
          200: "#bbf7d1",
          300: "#86efac",
          400: "#4ade80",
          500: "#55cf9e", // Main color
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
          950: "#052e16",
          // Navy, not white: white on mint is ~1.9:1 and fails contrast. The
          // marketing site's mint CTAs are navy-on-mint.
          foreground: "#202536",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Material 3 Surface Tokens
        surface: {
          DEFAULT: "#faf9f6", // cream — the marketing-site page background
          variant: "#e1e3de",
          container: {
            low: "#f7f9f2",
            lowest: "#ffffff",
            high: "#ebeee7",
            highest: "#e1e3de",
          }
        },
        "on-surface": {
          DEFAULT: "#1a1c1a",
          variant: "#3d4a42",
        },
        "on-primary-fixed": {
          DEFAULT: "#002114",
          variant: "#002114",
        },
        outline: {
          DEFAULT: "#6d7a72",
          variant: "#bccac0",
        },
        // --- Landing-site role tokens (paste-compatibility layer) ---
        // The names all creditbanc.io markup is written against. Without these,
        // pasted marketing markup silently renders unstyled colors.
        "on-secondary-fixed": {
          DEFAULT: "#202536", // navy — EVERY headline on light backgrounds
          variant: "#3f4565",
        },
        "primary-container": "#55cf9e", // mint fill for chips, pills, icon tiles
        "on-primary-container": "#00553b", // deep green text on mint
        "primary-fixed": {
          DEFAULT: "#a6f0ce", // pale mint — text on navy buttons
          dim: "#55cf9e",
        },
        "surface-bright": "#faf9f6",
        "surface-dim": "#dbdad7",
        "surface-tint": "#55cf9e",
        "inverse-surface": "#2f312f",
        "inverse-on-surface": "#f2f1ee",
        "secondary-container": "#d0d5fd",
        "cream-card": "#fdf8e8", // warm floating-card fill (hero cards)
        tertiary: {
          fixed: {
            DEFAULT: "#d9e3ff",
            dim: "#adc6ff",
            variant: "#3c475e",
          }
        },
        error: {
          DEFAULT: "#ba1a1a",
          container: "#ffdad6",
        },
        "on-error": {
          container: "#410002",
        },
        // creditbanc.io marketing-site brand tokens (from its tailwind config).
        // Note: emerald-500 / primary already equal cb.mint (#55cf9e).
        cb: {
          navy: "#202536", // dark surfaces (headers, footers, bands)
          mint: "#55cf9e", // primary accent
          gray: "#939598", // muted text
          cream: "#faf9f6", // warm off-white page background
          ink: "#1a1c1a", // near-black text
          // gradient stops — do not invent new greens, use these
          emerald900: "#0d3b2a",
          emerald800: "#10402c",
          emerald700: "#1f6b4e",
          emerald600: "#2ea878",
          emerald400: "#7bdcb0",
        },
        // Simplified color palette
        emerald: {
          50: "#f0fdf7",
          100: "#dcfce8",
          200: "#bbf7d1",
          300: "#86efac",
          400: "#4ade80",
          500: "#55cf9e", // Our primary color
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
          950: "#022c22", // Added 950 for sidebar
        },
      },
      fontFamily: {
        // Fed by next/font/google in src/app/layout.tsx; the literal names are
        // kept as fallbacks so the classes still resolve if the vars are missing.
        headline: ["var(--font-manrope)", "Manrope", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        label: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        manrope: ["var(--font-manrope)", "Manrope", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "0.75rem",
        "2xl": "1rem", // the default card radius
        "3xl": "1.5rem",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        aurora: {
          "0%, 100%": { transform: "translateX(-50%) translateY(-50%) scale(1)" },
          "50%": { transform: "translateX(-50%) translateY(-50%) scale(1.1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        aurora: "aurora 8s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config

export default config
