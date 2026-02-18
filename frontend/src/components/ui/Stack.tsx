import type { ElementType } from "react";

import type { StackProps } from "../../design/types";
import styles from "./Stack.module.css";

const GAP_CLASS: Record<NonNullable<StackProps["gap"]>, string> = {
  xs: styles.gapXs,
  sm: styles.gapSm,
  md: styles.gapMd,
  lg: styles.gapLg
};

export function Stack({ as = "div", className = "", gap = "md", fullWidth = false, style, children }: StackProps) {
  const Component = as as ElementType;
  const classes = [styles.stack, GAP_CLASS[gap], fullWidth ? styles.fullWidth : "", className].filter(Boolean).join(" ");
  return (
    <Component className={classes} style={style}>
      {children}
    </Component>
  );
}
