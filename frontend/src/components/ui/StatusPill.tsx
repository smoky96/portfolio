import { Tag } from "antd";

import type { StatusPillProps } from "../../design/types";
import styles from "./StatusPill.module.css";

const TONE_CLASS = {
  default: styles.default,
  info: styles.info,
  positive: styles.positive,
  negative: styles.negative,
  warning: styles.warning
};

export function StatusPill({ tone = "default", className = "", ...props }: StatusPillProps) {
  const classes = [styles.pill, TONE_CLASS[tone], className].filter(Boolean).join(" ");
  return <Tag className={classes} {...props} />;
}
