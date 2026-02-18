import type { ElementType } from "react";

import type { InlineProps } from "../../design/types";
import styles from "./Inline.module.css";

const ALIGN_CLASS: Record<NonNullable<InlineProps["align"]>, string> = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: styles.alignStretch
};

const JUSTIFY_CLASS: Record<NonNullable<InlineProps["justify"]>, string> = {
  start: styles.justifyStart,
  center: styles.justifyCenter,
  end: styles.justifyEnd,
  between: styles.justifyBetween
};

const GAP_CLASS: Record<NonNullable<InlineProps["gap"]>, string> = {
  xs: styles.gapXs,
  sm: styles.gapSm,
  md: styles.gapMd,
  lg: styles.gapLg
};

export function Inline({
  as = "div",
  className = "",
  align = "center",
  justify = "start",
  wrap = false,
  gap = "sm",
  style,
  children
}: InlineProps) {
  const Component = as as ElementType;
  const classes = [
    styles.inline,
    ALIGN_CLASS[align],
    JUSTIFY_CLASS[justify],
    GAP_CLASS[gap],
    wrap ? styles.wrap : "",
    className
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Component className={classes} style={style}>
      {children}
    </Component>
  );
}
