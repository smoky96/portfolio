import type { DesignTokens } from "./types";

export const designTokens: DesignTokens = {
  color: {
    bgBase: "#0f172a",
    bgCanvas: "#111c33",
    surface: "#12233f",
    surfaceSoft: "#172b4c",
    line: "#2d4368",
    lineStrong: "#3a5a89",
    textMain: "#e6eefb",
    textSub: "#9cb3d6",
    textFaint: "#7f95b9",
    primary: "#3d86ff",
    primaryStrong: "#2d6fda",
    primarySoft: "#1a3560",
    success: "#3bb273",
    warning: "#f2a93b",
    danger: "#f06565",
    info: "#57b2ff"
  },
  spacing: {
    s1: 4,
    s2: 8,
    s3: 12,
    s4: 16,
    s6: 24,
    s8: 32,
    s10: 40
  },
  radius: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 20,
    pill: 999
  },
  shadow: {
    soft: "0 10px 28px rgba(6, 10, 20, 0.32)",
    strong: "0 20px 44px rgba(5, 10, 20, 0.42)"
  },
  font: {
    body: '"Manrope", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    display: '"Archivo", "Noto Sans SC", sans-serif',
    mono: '"JetBrains Mono", "SFMono-Regular", "Consolas", monospace'
  },
  motion: {
    quick: "140ms",
    base: "220ms",
    smooth: "380ms",
    easing: "cubic-bezier(0.22, 1, 0.36, 1)"
  }
};
