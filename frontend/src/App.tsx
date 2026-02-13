import {
  AppstoreOutlined,
  BankOutlined,
  DollarOutlined,
  LogoutOutlined,
  MenuOutlined,
  PieChartOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  TagOutlined,
  TagsOutlined
} from "@ant-design/icons";
import { Button, Drawer, Grid, Layout, Space, Tag, Typography } from "antd";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { api } from "./api/client";
import { AuthSession, AuthUser, clearSession, getStoredSession, onAuthExpired } from "./auth/session";
import AccountsPage from "./pages/AccountsPage";
import AllocationPage from "./pages/AllocationPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import HoldingsPage from "./pages/HoldingsPage";
import TransactionsPage from "./pages/TransactionsPage";
import CustomInstrumentsPage from "./pages/CustomInstrumentsPage";
import TagGroupsPage from "./pages/TagGroupsPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import RegisterPage from "./pages/RegisterPage";

const { Header, Sider, Content } = Layout;

interface RouteMeta {
  title: string;
  subtitle: string;
}

const ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "仪表盘",
    subtitle: "投资组合总览与偏离监控"
  },
  "/allocation": {
    title: "资产配置",
    subtitle: "树形层级配置与目标比例管理"
  },
  "/tags": {
    title: "标签组",
    subtitle: "维护标签组、标签以及标的标签分配"
  },
  "/accounts": {
    title: "账户",
    subtitle: "维护现金账户与券商基金账户"
  },
  "/transactions": {
    title: "流水",
    subtitle: "交易流水录入、筛选与导入"
  },
  "/holdings": {
    title: "持仓",
    subtitle: "持仓盈亏与再平衡偏离监测"
  },
  "/custom-instruments": {
    title: "自定义标的",
    subtitle: "创建自定义标的并维护手工净值"
  },
  "/admin/users": {
    title: "用户管理",
    subtitle: "管理员创建用户、维护权限和邀请码"
  }
};

function navLabel(icon: ReactNode, label: string) {
  return (
    <Space>
      {icon}
      <span>{label}</span>
    </Space>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession());

  const navItems = useMemo(() => {
    const items = [
      { key: "/", label: navLabel(<PieChartOutlined />, "仪表盘") },
      { key: "/allocation", label: navLabel(<AppstoreOutlined />, "资产配置") },
      { key: "/tags", label: navLabel(<TagOutlined />, "标签组") },
      { key: "/accounts", label: navLabel(<BankOutlined />, "账户") },
      { key: "/transactions", label: navLabel(<SwapOutlined />, "流水") },
      { key: "/holdings", label: navLabel(<DollarOutlined />, "持仓") },
      { key: "/custom-instruments", label: navLabel(<TagsOutlined />, "自定义标的") }
    ];
    if (session?.user.role === "ADMIN") {
      items.push({ key: "/admin/users", label: navLabel(<SafetyCertificateOutlined />, "用户管理") });
    }
    return items;
  }, [session?.user.role]);

  useEffect(() => onAuthExpired(() => setSession(null)), []);

  useEffect(() => {
    if (!session) {
      return;
    }
    let active = true;
    void api
      .get<AuthUser>("/auth/me")
      .then((user) => {
        if (!active) {
          return;
        }
        setSession((prev) => (prev ? { ...prev, user } : prev));
      })
      .catch(() => {
        if (!active) {
          return;
        }
        clearSession();
        setSession(null);
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  if (!session) {
    const redirectFrom = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={(nextSession) => setSession(nextSession)} />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: redirectFrom }} />} />
      </Routes>
    );
  }

  const selectedKey = (() => {
    const pathname = location.pathname.startsWith("/instruments") ? "/holdings" : location.pathname;
    if (pathname === "/") {
      return "/";
    }
    const found = navItems.find((item) => pathname.startsWith(item.key) && item.key !== "/");
    return found?.key ?? "/";
  })();

  const routeMeta = ROUTE_META[selectedKey] ?? ROUTE_META["/"];
  const nowText = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());

  function handleLogout() {
    clearSession();
    setSession(null);
    navigate("/login", { replace: true });
  }

  function renderNav(onNavigate?: () => void) {
    return (
      <nav className="side-nav" aria-label="主导航">
        {navItems.map((item) => {
          const active = selectedKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`side-nav-item${active ? " is-active" : ""}`}
              onClick={() => {
                navigate(item.key);
                onNavigate?.();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <Layout className="app-layout">
      {!isMobile && (
        <Sider width={240} breakpoint="lg" collapsedWidth="0" className="app-sider">
          <div className="brand-wrap">
            <Typography.Text className="brand-chip">PORTFOLIO ATLAS</Typography.Text>
            <Typography.Title level={4} className="brand-title">
              投资组合管理
            </Typography.Title>
            <Typography.Text className="brand-subtitle">配置 · 交易 · 持仓 · 归因</Typography.Text>
          </div>
          {renderNav()}
          <div className="sider-foot">
            <Tag color="blue">记账本位币 CNY</Tag>
            <Tag color="geekblue">时区 Asia/Shanghai</Tag>
          </div>
        </Sider>
      )}
      <Layout>
        <Header className="app-header">
          <div className="header-main">
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileNavOpen(true)}
                aria-label="打开导航菜单"
                className="mobile-menu-btn"
              />
            )}
            <Typography.Title level={3} className="page-title">
              {routeMeta.title}
            </Typography.Title>
            <Typography.Text type="secondary" className="page-subtitle">
              {routeMeta.subtitle}
            </Typography.Text>
          </div>
          <Space size={8} className="header-actions">
            <Tag color="default" className="header-meta-tag">
              更新时间 {nowText}
            </Tag>
            <Tag color="blue" className="header-user-tag">
              {session.user.username}
            </Tag>
            <Button size={isMobile ? "small" : "middle"} icon={<LogoutOutlined />} onClick={handleLogout}>
              {isMobile ? "退出" : "退出登录"}
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Routes>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/register" element={<Navigate to="/" replace />} />
            <Route path="/" element={<DashboardPage />} />
            <Route path="/allocation" element={<AllocationPage />} />
            <Route path="/tags" element={<TagGroupsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/instruments" element={<Navigate to="/holdings" replace />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/holdings" element={<HoldingsPage />} />
            <Route path="/custom-instruments" element={<CustomInstrumentsPage />} />
            <Route path="/admin/users" element={session.user.role === "ADMIN" ? <AdminUsersPage /> : <Navigate to="/" replace />} />
            <Route path="/quotes" element={<Navigate to="/custom-instruments" replace />} />
          </Routes>
        </Content>
      </Layout>
      <Drawer
        title="导航"
        placement="left"
        open={isMobile && mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        width={280}
        className="app-drawer"
      >
        {renderNav(() => setMobileNavOpen(false))}
        <div className="drawer-foot">
          <Tag color="blue">记账本位币 CNY</Tag>
          <Tag color="geekblue">时区 Asia/Shanghai</Tag>
        </div>
      </Drawer>
    </Layout>
  );
}
