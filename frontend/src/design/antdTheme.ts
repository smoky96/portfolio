import type { ThemeConfig } from "antd";

import { designTokens } from "./tokens";

export function createAntdTheme(): ThemeConfig {
  return {
    token: {
      colorPrimary: designTokens.color.primary,
      colorSuccess: designTokens.color.success,
      colorWarning: designTokens.color.warning,
      colorError: designTokens.color.danger,
      colorText: designTokens.color.textMain,
      colorTextSecondary: designTokens.color.textSub,
      colorBorder: designTokens.color.line,
      colorBgBase: designTokens.color.bgBase,
      colorBgContainer: designTokens.color.surface,
      colorFillSecondary: designTokens.color.surfaceSoft,
      borderRadius: designTokens.radius.sm,
      borderRadiusLG: designTokens.radius.md,
      fontFamily: designTokens.font.body,
      fontSize: 14
    },
    components: {
      Layout: {
        headerBg: "transparent",
        bodyBg: designTokens.color.bgBase,
        siderBg: designTokens.color.bgCanvas
      },
      Card: {
        headerFontSize: 14,
        bodyPadding: 16,
        colorBorderSecondary: designTokens.color.line,
        headerHeight: 52
      },
      Table: {
        headerBg: "#182d4d",
        rowHoverBg: "#1a3459",
        borderColor: designTokens.color.line
      },
      Button: {
        fontWeight: 600,
        controlHeight: 38,
        defaultBg: "#1a3258",
        defaultBorderColor: designTokens.color.lineStrong,
        defaultColor: designTokens.color.textMain
      },
      Input: {
        controlHeight: 40,
        activeBorderColor: designTokens.color.primary,
        hoverBorderColor: designTokens.color.primary
      },
      Select: {
        controlHeight: 40,
        optionActiveBg: "#1a3258",
        optionSelectedBg: "#1e3b66"
      },
      Segmented: {
        itemSelectedBg: "#1f3d6a",
        itemHoverBg: "#1a3258"
      },
      Tag: {
        defaultBg: "#1b3358",
        defaultColor: designTokens.color.textMain
      }
    }
  };
}
