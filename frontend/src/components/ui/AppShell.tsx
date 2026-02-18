import { LogoutOutlined, MenuOutlined } from "@ant-design/icons";
import { Button, Drawer, Layout, Space, Typography } from "antd";

import type { AppShellProps } from "../../design/types";
import { StatusPill } from "./StatusPill";
import styles from "./AppShell.module.css";

const { Header, Sider, Content } = Layout;

function navItemClass(isActive: boolean): string {
  return ["side-nav-item", styles.sideNavItem, isActive ? "is-active" : "", isActive ? styles.sideNavItemActive : ""]
    .filter(Boolean)
    .join(" ");
}

export function AppShell({
  version,
  isMobile,
  selectedKey,
  title,
  subtitle,
  username,
  nowText,
  navItems,
  onNavigate,
  onLogout,
  mobileNavOpen,
  onOpenMobileNav,
  onCloseMobileNav,
  children
}: AppShellProps) {
  function renderNav(onNavigateDone?: () => void) {
    return (
      <nav className={["side-nav", styles.sideNav].join(" ")} aria-label="主导航">
        {navItems.map((item) => {
          const active = selectedKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={navItemClass(active)}
              onClick={() => {
                onNavigate(item.key);
                onNavigateDone?.();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    );
  }

  const rootClassName = ["app-root", version === "v2" ? "app-root--v2" : "app-root--v1", styles.appRoot].join(" ");

  return (
    <div className={rootClassName}>
      <Layout className={["app-layout", styles.appLayout].join(" ")}>
        {!isMobile && (
          <Sider width={240} breakpoint="lg" collapsedWidth="0" className={["app-sider", styles.appSider].join(" ")}>
            <div className={styles.brandWrap}>
              <Typography.Text className={styles.brandChip}>PORTFOLIO ATLAS</Typography.Text>
              <Typography.Title level={4} className={styles.brandTitle}>
                投资组合管理
              </Typography.Title>
              <Typography.Text className={styles.brandSubtitle}>配置 · 交易 · 持仓 · 归因</Typography.Text>
            </div>
            {renderNav()}
            <div className={["sider-foot", styles.siderFoot].join(" ")}>
              <StatusPill tone="info">记账本位币 CNY</StatusPill>
              <StatusPill tone="default">时区 Asia/Shanghai</StatusPill>
            </div>
          </Sider>
        )}

        <Layout className={styles.mainLayout}>
          <Header className={["app-header", styles.appHeader].join(" ")}>
            <div className={["header-main", styles.headerMain].join(" ")}>
              {isMobile && (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={onOpenMobileNav}
                  aria-label="打开导航菜单"
                  className={["mobile-menu-btn", styles.mobileMenuBtn].join(" ")}
                />
              )}
              <Typography.Title level={3} className={["page-title", styles.pageTitle].join(" ")}>
                {title}
              </Typography.Title>
              <Typography.Text className={["page-subtitle", styles.pageSubtitle].join(" ")}>
                {subtitle}
              </Typography.Text>
            </div>

            <Space size={8} className={["header-actions", styles.headerActions].join(" ")}>
              <StatusPill tone="default" className="header-meta-tag">
                更新时间 {nowText}
              </StatusPill>
              <StatusPill tone="info" className="header-user-tag">
                {username}
              </StatusPill>
              <Button size={isMobile ? "small" : "middle"} icon={<LogoutOutlined />} onClick={onLogout} className={styles.logoutButton}>
                {isMobile ? "退出" : "退出登录"}
              </Button>
            </Space>
          </Header>

          <Content className={["app-content", styles.appContent].join(" ")}>{children}</Content>
        </Layout>

        <Drawer
          title="导航"
          placement="left"
          open={isMobile && mobileNavOpen}
          onClose={onCloseMobileNav}
          width={280}
          className={["app-drawer", styles.appDrawer].join(" ")}
        >
          {renderNav(onCloseMobileNav)}
          <div className={["drawer-foot", styles.drawerFoot].join(" ")}>
            <StatusPill tone="info">记账本位币 CNY</StatusPill>
            <StatusPill tone="default">时区 Asia/Shanghai</StatusPill>
          </div>
        </Drawer>
      </Layout>
    </div>
  );
}
