import { Alert, Button, Card, Form, Input, InputNumber, Select, Switch, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { AuthUser, UserRole } from "../auth/session";

interface InviteCodeItem {
  id: number;
  code: string;
  created_by_id: number | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface AdminUserCreateForm {
  username: string;
  password: string;
  role: UserRole;
}

interface InviteCreateForm {
  code?: string;
  max_uses?: number;
  expires_at?: string;
  note?: string;
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(ts));
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCodeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [userForm] = Form.useForm<AdminUserCreateForm>();
  const [inviteForm] = Form.useForm<InviteCreateForm>();

  async function load() {
    setLoading(true);
    try {
      const [usersResp, inviteResp] = await Promise.all([
        api.get<AuthUser[]>("/admin/users"),
        api.get<InviteCodeItem[]>("/admin/invite-codes")
      ]);
      setUsers(usersResp);
      setInviteCodes(inviteResp);
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => {
    const adminCount = users.filter((item) => item.role === "ADMIN").length;
    const activeCount = users.filter((item) => item.is_active).length;
    const activeInviteCount = inviteCodes.filter((item) => item.is_active).length;
    return {
      userTotal: users.length,
      adminCount,
      activeCount,
      activeInviteCount
    };
  }, [users, inviteCodes]);

  async function createUser(values: AdminUserCreateForm) {
    try {
      await api.post<AuthUser>("/admin/users", values);
      message.success("用户已创建");
      userForm.resetFields(["username", "password"]);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function updateUser(userId: number, payload: Partial<{ role: UserRole; is_active: boolean }>) {
    try {
      await api.patch<AuthUser>(`/admin/users/${userId}`, payload);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function createInviteCode(values: InviteCreateForm) {
    const payload = {
      code: values.code?.trim() || undefined,
      max_uses: values.max_uses ?? null,
      expires_at: values.expires_at?.trim() || null,
      note: values.note?.trim() || null
    };
    try {
      await api.post<InviteCodeItem>("/admin/invite-codes", payload);
      message.success("邀请码已创建");
      inviteForm.resetFields();
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function deactivateInviteCode(invite: InviteCodeItem) {
    try {
      await api.patch<InviteCodeItem>(`/admin/invite-codes/${invite.id}`, {
        is_active: !invite.is_active
      });
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="page-stack admin-users-page">
      {error && <Alert type="error" showIcon message="请求失败" description={error} closable onClose={() => setError("")} />}

      <div className="admin-users-stats page-section">
        <Card className="admin-users-stat-card">
          <Typography.Text className="admin-users-stat-label">用户总数</Typography.Text>
          <Typography.Title level={3} className="admin-users-stat-value">
            {stats.userTotal}
          </Typography.Title>
        </Card>
        <Card className="admin-users-stat-card">
          <Typography.Text className="admin-users-stat-label">管理员</Typography.Text>
          <Typography.Title level={3} className="admin-users-stat-value">
            {stats.adminCount}
          </Typography.Title>
        </Card>
        <Card className="admin-users-stat-card">
          <Typography.Text className="admin-users-stat-label">启用用户</Typography.Text>
          <Typography.Title level={3} className="admin-users-stat-value">
            {stats.activeCount}
          </Typography.Title>
        </Card>
        <Card className="admin-users-stat-card">
          <Typography.Text className="admin-users-stat-label">启用邀请码</Typography.Text>
          <Typography.Title level={3} className="admin-users-stat-value">
            {stats.activeInviteCount}
          </Typography.Title>
        </Card>
      </div>

      <div className="admin-users-actions page-section">
        <Card title="创建用户" loading={loading} className="admin-users-action-card accounts-create-card">
          <Form<AdminUserCreateForm>
            form={userForm}
            layout="vertical"
            className="admin-users-inline-form admin-users-inline-form-user"
            onFinish={(values) => void createUser(values)}
            initialValues={{ role: "MEMBER" }}
          >
            <Form.Item label="账号" name="username" rules={[{ required: true, message: "请输入账号" }]}>
              <Input placeholder="例如：alice" />
            </Form.Item>
            <Form.Item label="初始密码" name="password" rules={[{ required: true, message: "请输入初始密码" }, { min: 8, message: "密码至少 8 位" }]}>
              <Input.Password placeholder="至少 8 位" />
            </Form.Item>
            <Form.Item label="角色" name="role" rules={[{ required: true, message: "请选择角色" }]}>
              <Select
                options={[
                  { value: "MEMBER", label: "普通用户" },
                  { value: "ADMIN", label: "管理员" }
                ]}
              />
            </Form.Item>
            <Form.Item className="admin-users-form-action">
              <Button type="primary" htmlType="submit" block>
                创建用户
              </Button>
            </Form.Item>
          </Form>
        </Card>

        <Card title="创建邀请码" loading={loading} className="admin-users-action-card accounts-create-card">
          <Form<InviteCreateForm>
            form={inviteForm}
            layout="vertical"
            className="admin-users-inline-form admin-users-inline-form-invite"
            onFinish={(values) => void createInviteCode(values)}
          >
            <Form.Item label="邀请码（可选）" name="code">
              <Input placeholder="留空则自动生成" />
            </Form.Item>
            <Form.Item label="最大使用次数（可选）" name="max_uses">
              <InputNumber min={1} style={{ width: "100%" }} placeholder="留空表示不限制" />
            </Form.Item>
            <Form.Item label="过期时间（可选）" name="expires_at">
              <Input placeholder="ISO 时间，如 2026-12-31T23:59:59+08:00" />
            </Form.Item>
            <Form.Item label="备注" name="note">
              <Input placeholder="例如：运营活动批次 A" />
            </Form.Item>
            <Form.Item className="admin-users-form-action">
              <Button type="primary" htmlType="submit" block>
                创建邀请码
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </div>

      <div className="admin-users-table-grid page-section">
        <Card
          title="用户列表"
          className="admin-users-table-card"
          loading={loading}
          extra={
            <Tag color={stats.userTotal > 0 ? "blue" : "default"}>
              已启用 {stats.activeCount}/{stats.userTotal}
            </Tag>
          }
        >
          <Table<AuthUser>
            rowKey="id"
            pagination={false}
            size="middle"
            scroll={{ x: 760 }}
            dataSource={users}
            columns={[
              {
                title: "账号",
                dataIndex: "username",
                width: 180
              },
              {
                title: "角色",
                key: "role",
                width: 150,
                render: (_: unknown, record: AuthUser) => (
                  <Select<UserRole>
                    value={record.role}
                    style={{ width: 120 }}
                    options={[
                      { value: "MEMBER", label: "普通用户" },
                      { value: "ADMIN", label: "管理员" }
                    ]}
                    onChange={(role) => void updateUser(record.id, { role })}
                  />
                )
              },
              {
                title: "状态",
                key: "is_active",
                width: 120,
                align: "center",
                render: (_: unknown, record: AuthUser) => (
                  <Switch checked={record.is_active} onChange={(checked) => void updateUser(record.id, { is_active: checked })} />
                )
              },
              {
                title: "最近登录",
                dataIndex: "last_login_at",
                width: 170,
                render: (value: string | null) => formatDate(value)
              },
              {
                title: "创建时间",
                dataIndex: "created_at",
                width: 170,
                render: (value: string) => formatDate(value)
              }
            ]}
          />
        </Card>

        <Card
          title="邀请码列表"
          className="admin-users-table-card"
          loading={loading}
          extra={
            <Tag color={stats.activeInviteCount > 0 ? "green" : "default"}>
              启用 {stats.activeInviteCount}
            </Tag>
          }
        >
          <Table<InviteCodeItem>
            rowKey="id"
            pagination={false}
            size="middle"
            scroll={{ x: 760 }}
            dataSource={inviteCodes}
            columns={[
              { title: "邀请码", dataIndex: "code", width: 160 },
              {
                title: "状态",
                key: "status",
                width: 100,
                render: (_: unknown, record: InviteCodeItem) =>
                  record.is_active ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>
              },
              {
                title: "已用/上限",
                key: "usage",
                width: 120,
                render: (_: unknown, record: InviteCodeItem) => `${record.used_count}/${record.max_uses ?? "∞"}`
              },
              {
                title: "过期时间",
                dataIndex: "expires_at",
                width: 180,
                render: (value: string | null) => formatDate(value)
              },
              {
                title: "备注",
                dataIndex: "note",
                ellipsis: true,
                render: (value: string | null) => value || "-"
              },
              {
                title: "操作",
                key: "actions",
                width: 88,
                render: (_: unknown, record: InviteCodeItem) => (
                  <Button type="link" onClick={() => void deactivateInviteCode(record)}>
                    {record.is_active ? "停用" : "启用"}
                  </Button>
                )
              }
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
