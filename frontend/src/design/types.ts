import type { CardProps, TagProps } from "antd";
import type { CSSProperties, ReactNode } from "react";

export type UiVersion = "v1" | "v2";
export type StatusTone = "default" | "info" | "positive" | "negative" | "warning";

export interface AppShellNavItem {
  key: string;
  label: ReactNode;
}

export interface AppShellProps {
  version: UiVersion;
  isMobile: boolean;
  selectedKey: string;
  title: string;
  subtitle: string;
  username: string;
  nowText: string;
  navItems: AppShellNavItem[];
  onNavigate: (key: string) => void;
  onLogout: () => void;
  mobileNavOpen: boolean;
  onOpenMobileNav: () => void;
  onCloseMobileNav: () => void;
  children: ReactNode;
}

export interface SurfaceCardProps extends CardProps {
  tone?: "default" | "soft";
}

export interface StackProps {
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  gap?: "xs" | "sm" | "md" | "lg";
  fullWidth?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

export interface InlineProps {
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  gap?: "xs" | "sm" | "md" | "lg";
  style?: CSSProperties;
  children: ReactNode;
}

export interface StatusPillProps extends Omit<TagProps, "color"> {
  tone?: StatusTone;
}

export interface DesignTokens {
  color: Record<string, string>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
  shadow: Record<string, string>;
  font: Record<string, string>;
  motion: Record<string, string | number>;
}
