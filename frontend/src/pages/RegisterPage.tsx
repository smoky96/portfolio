import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { AuthUser } from "../auth/session";

interface RegisterFormValues {
  invite_code: string;
  username: string;
  password: string;
  confirm_password: string;
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<RegisterFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  async function handleSubmit(values: RegisterFormValues) {
    setSubmitting(true);
    setErrorText("");
    setSuccessText("");
    try {
      await api.post<AuthUser>("/auth/register", {
        invite_code: values.invite_code,
        username: values.username,
        password: values.password,
      });
      setSuccessText("注册成功，请使用新账号登录。");
      setTimeout(() => {
        navigate("/login", {
          replace: true,
          state: { from: "/", prefillUsername: values.username },
        });
      }, 600);
    } catch (err) {
      setErrorText(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page" data-testid="register-page">
      <div className="login-bg-glow login-bg-glow-left" />
      <div className="login-bg-glow login-bg-glow-right" />
      <Card className="login-card" bordered={false}>
        <div className="login-brand">
          <Typography.Text className="brand-chip">PORTFOLIO ATLAS</Typography.Text>
          <Typography.Title level={2} className="login-title">
            创建账号
          </Typography.Title>
          <Typography.Text type="secondary" className="login-subtitle">
            通过邀请码注册后即可登录系统
          </Typography.Text>
        </div>

        {errorText && <Alert type="error" showIcon message={errorText} style={{ marginBottom: 12 }} />}
        {successText && <Alert type="success" showIcon message={successText} style={{ marginBottom: 12 }} />}

        <Form<RegisterFormValues> layout="vertical" form={form} onFinish={(values) => void handleSubmit(values)}>
          <Form.Item label="邀请码" name="invite_code" rules={[{ required: true, message: "请输入邀请码" }]}>
            <Input prefix={<SafetyCertificateOutlined />} placeholder="请输入邀请码" />
          </Form.Item>
          <Form.Item label="账号" name="username" rules={[{ required: true, message: "请输入账号" }]}>
            <Input prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 8, message: "密码至少 8 位" },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位密码" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="确认密码"
            name="confirm_password"
            dependencies={["password"]}
            rules={[
              { required: true, message: "请再次输入密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("password") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("两次输入的密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="请再次输入密码" autoComplete="new-password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={submitting} block>
            注册账号
          </Button>
        </Form>

        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Typography.Text type="secondary">
            已有账号？<Link to="/login">返回登录</Link>
          </Typography.Text>
        </div>
      </Card>
    </div>
  );
}
