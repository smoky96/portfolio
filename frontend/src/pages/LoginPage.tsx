import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Form, Input, Space, Typography } from "antd";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { AuthSession, getRememberedUsername, saveSession } from "../auth/session";

interface LoginFormValues {
  username: string;
  password: string;
  remember_username: boolean;
}

interface LoginPageProps {
  onLogin: (session: AuthSession) => void;
}

function resolveRedirectPath(raw: unknown) {
  if (typeof raw !== "string") {
    return "/";
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) {
    return "/";
  }
  return raw;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm<LoginFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  const locationState = (location.state as { from?: string; prefillUsername?: string } | null) ?? null;
  const rememberedUsername = locationState?.prefillUsername ?? getRememberedUsername();
  const defaultValues: LoginFormValues = {
    username: rememberedUsername,
    password: "",
    remember_username: Boolean(rememberedUsername)
  };

  async function handleSubmit(values: LoginFormValues) {
    setSubmitting(true);
    setErrorText("");
    try {
      const session = await api.post<AuthSession>("/auth/login", {
        username: values.username,
        password: values.password
      });
      saveSession(session, values.remember_username);
      onLogin(session);
      const redirectPath = resolveRedirectPath(locationState?.from);
      navigate(redirectPath, { replace: true });
    } catch {
      setErrorText("账号或密码错误，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page" data-testid="login-page">
      <div className="login-bg-glow login-bg-glow-left" />
      <div className="login-bg-glow login-bg-glow-right" />
      <Card className="login-card" bordered={false}>
        <div className="login-brand">
          <Typography.Text className="brand-chip">PORTFOLIO ATLAS</Typography.Text>
          <Typography.Title level={2} className="login-title">
            投资组合管理
          </Typography.Title>
          <Typography.Text type="secondary" className="login-subtitle">
            登录后可继续管理资产配置、流水与持仓分析
          </Typography.Text>
        </div>

        {errorText && <Alert type="error" showIcon message={errorText} />}

        <Form<LoginFormValues> layout="vertical" form={form} initialValues={defaultValues} onFinish={(values) => void handleSubmit(values)}>
          <Form.Item label="账号" name="username" rules={[{ required: true, message: "请输入账号" }]}>
            <Input id="login-username" prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" />
          </Form.Item>

          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password id="login-password" prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>

          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Form.Item name="remember_username" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>记住账号</Checkbox>
            </Form.Item>

            <Button type="primary" htmlType="submit" loading={submitting} block>
              登录系统
            </Button>
          </Space>
        </Form>

        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Typography.Text type="secondary">
            没有账号？<Link to="/register">使用邀请码注册</Link>
          </Typography.Text>
        </div>
      </Card>
    </div>
  );
}
