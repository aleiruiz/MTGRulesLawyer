import { createContext } from "react";

/**
 * True once the theme's custom fonts are loaded. Screens mount before that (behind the loading
 * screen), and Android keeps a text layout measured with the fallback font even after the custom
 * font arrives, which clips wider text. Text applies custom font families only once this is true,
 * so the style change makes Android measure again.
 */
export const FontsReadyContext = createContext(true);
