import { Card } from "antd";

import type { SurfaceCardProps } from "../../design/types";
import styles from "./SurfaceCard.module.css";

export function SurfaceCard({ className = "", tone = "default", ...props }: SurfaceCardProps) {
  const classes = [styles.surfaceCard, tone === "soft" ? styles.toneSoft : "", className].filter(Boolean).join(" ");
  return <Card className={classes} {...props} />;
}
