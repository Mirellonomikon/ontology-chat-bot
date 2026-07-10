import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

// Custom palette ("Midnight Violet + Frosted Blue") applied to both light and dark mode.
//
// The app expresses its brand accent entirely through Chakra's `blue.*` palette plus a few
// hard-coded gradient hex values. By overriding the raw `blue` scale here, every existing
// `blue.50 / blue.500 / blue.subtle / ...` usage recolors automatically — no component edits.
// Surface/text semantic tokens are overridden to give light/dark their respective moods.
//
// Source swatches:
//   36213E Midnight Violet · 554971 Vintage Grape · 63768D Slate Grey ·
//   8AC6D0 Frosted Blue · B8F3FF Frosted Blue light
const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        // Brand ramp anchored on the five palette swatches; the in-between and
        // extreme shades are interpolated within the palette's blue-violet hue
        // (no off-palette magenta near-blacks). Overrides `blue` so every existing
        // blue.* usage recolors automatically.
        //   500 Vintage Grape  = primary accent (borders, active icons)
        //   400 Slate Grey      = focus / hover borders
        //   300 Frosted Blue    = dark-mode accent text
        //   700 Midnight Violet = deepest brand anchor
        blue: {
          50:  { value: '#F0FBFE' },  // palest frosted tint (light bubbles)
          100: { value: '#D7F4FB' },  // light subtle tint
          200: { value: '#B8F3FF' },  // Frosted Blue light
          300: { value: '#8AC6D0' },  // Frosted Blue
          400: { value: '#63768D' },  // Slate Grey
          500: { value: '#554971' },  // Vintage Grape — primary accent
          600: { value: '#463658' },  // Grape→Violet blend
          700: { value: '#36213E' },  // Midnight Violet
          800: { value: '#2A1A30' },  // darkened Midnight Violet (kept violet hue)
          900: { value: '#1F1324' },  // deep violet (dark subtle tint)
          950: { value: '#170E1A' },  // near-black violet
        },
        pop:   { 500: { value: '#8AC6D0' } }, // frosted blue accent
        frost: { 500: { value: '#B8F3FF' } }, // lightest frosted
      },
    },
    semanticTokens: {
      colors: {
        // Light: pale frosted-blue surfaces. Dark: Midnight Violet family,
        // panel sitting one step lighter than the canvas for separation.
        bg: {
          DEFAULT: { value: { _light: '#F2FBFE', _dark: '#1B1020' } },
          canvas:  { value: { _light: '#F2FBFE', _dark: '#1B1020' } },
          panel:   { value: { _light: '#FFFFFF', _dark: '#2A1A31' } },
          muted:   { value: { _light: '#DCF2F8', _dark: '#3A2748' } },
          subtle:  { value: { _light: '#EDF8FB', _dark: '#2F1E39' } },
        },
        // Light text steps down Violet → Grape → Slate Grey.
        // Dark text steps down Frosted-light → Frosted → muted Slate-frost.
        fg: {
          DEFAULT: { value: { _light: '#36213E', _dark: '#B8F3FF' } },
          muted:   { value: { _light: '#554971', _dark: '#8AC6D0' } },
          subtle:  { value: { _light: '#63768D', _dark: '#6E97A0' } },
        },
        border: {
          muted: { value: { _light: '#C5E4EC', _dark: '#3D2A4D' } },
        },
        brand: {
          accent: { value: { _light: '#554971', _dark: '#8AC6D0' } },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
