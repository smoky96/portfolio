import { Alert, Button, Card, Form, Input, Select, Space, Table, Tag, Typography } from "antd";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { ACCOUNT_TYPE_LABELS } from "../constants/labels";
import { Account, DashboardSummary, Holding, ReturnCurvePoint } from "../types";
import { formatDecimal } from "../utils/format";

interface AccountForm {
  name: string;
  type: "CASH" | "BROKERAGE";
  base_currency: string;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [curve, setCurve] = useState<ReturnCurvePoint[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<AccountForm>();

  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "CASH" | "BROKERAGE">("ALL");

  const currencyOptions = useMemo(
    () => [
      { value: "CNY", label: "CNY - 人民币" },
      { value: "USD", label: "USD - 美元" },
      { value: "HKD", label: "HKD - 港币" },
      { value: "EUR", label: "EUR - 欧元" },
      { value: "GBP", label: "GBP - 英镑" },
      { value: "JPY", label: "JPY - 日元" },
      { value: "SGD", label: "SGD - 新加坡元" }
    ],
    []
  );

  function buildAssetsCurveOption(points: ReturnCurvePoint[]): EChartsOption | null {
    if (points.length < 2) {
      return null;
    }

    const xAxis = points.map((item) => {
      const date = new Date(item.date);
      if (Number.isNaN(date.getTime())) {
        return item.date;
      }
      return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    });
    const values = points.map((item) => Number(item.total_assets));

    if (values.every((value) => !Number.isFinite(value))) {
      return null;
    }

    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);
    const span = Math.max(maxValue - minValue, 1);
    const padding = span * 0.15;

    return {
      animationDuration: 500,
      grid: {
        left: 64,
        right: 20,
        top: 16,
        bottom: 32
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "line",
          lineStyle: { color: "#9fb5d4" }
        },
        valueFormatter: (value: unknown) => formatDecimal(typeof value === "number" ? value : Number(value))
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: xAxis,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#dce4f2" } },
        axisLabel: { color: "#8c8c8c", fontSize: 10 }
      },
      yAxis: {
        type: "value",
        min: Number((minValue - padding).toFixed(3)),
        max: Number((maxValue + padding).toFixed(3)),
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#8c8c8c",
          fontSize: 10,
          formatter: (value: number) => formatDecimal(value)
        },
        splitLine: {
          lineStyle: {
            color: "#e6edf8"
          }
        }
      },
      series: [
        {
          type: "line",
          data: values.map((value) => Number(value.toFixed(3))),
          smooth: 0.35,
          showSymbol: false,
          lineStyle: {
            color: "#1f4f94",
            width: 2.5
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(31, 79, 148, 0.26)" },
                { offset: 1, color: "rgba(31, 79, 148, 0.04)" }
              ]
            }
          }
        }
      ]
    };
  }

  async function load() {
    setLoading(true);
    try {
      const [accountData, summaryData, holdingsData, curveData] = await Promise.all([
        api.get<Account[]>("/accounts"),
        api.get<DashboardSummary>("/dashboard/summary"),
        api.get<Holding[]>("/holdings"),
        api.get<ReturnCurvePoint[]>("/dashboard/returns-curve?days=180")
      ]);
      setAccounts(accountData);
      setSummary(summaryData);
      setHoldings(holdingsData);
      setCurve(curveData);
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    form.setFieldsValue({ name: "", type: "CASH", base_currency: "CNY" });
    void load();
  }, []);

  async function onCreate(values: AccountForm) {
    try {
      await api.post<Account>("/accounts", {
        ...values,
        base_currency: values.base_currency.toUpperCase(),
        is_active: true
      });
      setMessage("账户已创建");
      form.resetFields();
      form.setFieldValue("type", "CASH");
      form.setFieldValue("base_currency", "CNY");
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  const filteredAccounts = useMemo(() => {
    return accounts.filter((item) => {
      const byKeyword = keyword ? item.name.toLowerCase().includes(keyword.toLowerCase()) : true;
      const byType = typeFilter === "ALL" ? true : item.type === typeFilter;
      return byKeyword && byType;
    });
  }, [accounts, keyword, typeFilter]);

  const cashBalanceMap = useMemo(() => {
    const map = new Map<number, number>();
    if (!summary) {
      return map;
    }
    summary.account_balances.forEach((item) => {
      map.set(item.account_id, Number(item.base_cash_balance));
    });
    return map;
  }, [summary]);

  const holdingMarketValueMap = useMemo(() => {
    const map = new Map<number, number>();
    holdings.forEach((item) => {
      const current = map.get(item.account_id) ?? 0;
      map.set(item.account_id, current + Number(item.market_value));
    });
    return map;
  }, [holdings]);

  const accountRows = useMemo(() => {
    return filteredAccounts.map((item) => {
      const cashBalance = cashBalanceMap.get(item.id) ?? 0;
      const holdingMarketValue = holdingMarketValueMap.get(item.id) ?? 0;
      return {
        ...item,
        cash_balance: cashBalance,
        holding_market_value: holdingMarketValue,
        total_balance: cashBalance + holdingMarketValue
      };
    });
  }, [filteredAccounts, cashBalanceMap, holdingMarketValueMap]);

  const assetsCurveOption = useMemo(() => buildAssetsCurveOption(curve), [curve]);
  const baseCurrency = summary?.base_currency ?? "CNY";

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }} className="page-stack accounts-page">
      {error && <Alert type="error" showIcon message="请求失败" description={error} closable />}
      {message && <Alert type="success" showIcon message={message} closable />}

      <Card
        className="page-section"
        title={`账户总资产曲线（${baseCurrency}）`}
        extra={
          <Typography.Text type="secondary">
            最新资产：{curve.length ? formatDecimal(curve[curve.length - 1]?.total_assets ?? null) : "-"}
          </Typography.Text>
        }
      >
        {assetsCurveOption ? (
          <div className="chart-frame chart-frame-curve">
            <ReactECharts option={assetsCurveOption} notMerge lazyUpdate className="dashboard-echart dashboard-echart-curve" />
          </div>
        ) : (
          <div className="chart-empty">暂无可展示资产曲线数据</div>
        )}
      </Card>

      <Card className="page-section" title="新增账户">
        <Form<AccountForm> layout="vertical" form={form} onFinish={(values) => void onCreate(values)}>
          <div className="page-grid">
            <Form.Item label="账户名称" name="name" rules={[{ required: true, message: "请输入账户名称" }]}>
              <Input placeholder="例如：A股券商账户" />
            </Form.Item>
            <Form.Item label="账户类型" name="type" rules={[{ required: true, message: "请选择账户类型" }]}>
              <Select
                options={[
                  { value: "CASH", label: ACCOUNT_TYPE_LABELS.CASH },
                  { value: "BROKERAGE", label: ACCOUNT_TYPE_LABELS.BROKERAGE }
                ]}
              />
            </Form.Item>
            <Form.Item label="账户币种" name="base_currency" rules={[{ required: true, message: "请选择币种" }]}>
              <Select options={currencyOptions} showSearch optionFilterProp="label" placeholder="请选择常用币种" />
            </Form.Item>
          </div>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              创建账户
            </Button>
            <Button onClick={() => void load()} loading={loading}>
              刷新
            </Button>
          </Space>
        </Form>
      </Card>

      <Card className="page-section" title="账户列表">
        <div className="page-toolbar">
          <Input
            placeholder="按账户名称搜索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            style={{ maxWidth: 220 }}
            allowClear
          />
          <Select
            value={typeFilter}
            onChange={(value) => setTypeFilter(value)}
            options={[
              { value: "ALL", label: "全部类型" },
              { value: "CASH", label: ACCOUNT_TYPE_LABELS.CASH },
              { value: "BROKERAGE", label: ACCOUNT_TYPE_LABELS.BROKERAGE }
            ]}
            style={{ width: 160 }}
          />
          <Button
            onClick={() => {
              setKeyword("");
              setTypeFilter("ALL");
            }}
          >
            清空筛选
          </Button>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 760 }}
          dataSource={accountRows}
          columns={[
            { title: "账户名称", dataIndex: "name" },
            {
              title: "账户类型",
              dataIndex: "type",
              render: (value: Account["type"]) => <Tag color={value === "CASH" ? "blue" : "purple"}>{ACCOUNT_TYPE_LABELS[value]}</Tag>
            },
            { title: "币种", dataIndex: "base_currency" },
            {
              title: `账户余额（${baseCurrency}）`,
              dataIndex: "total_balance",
              render: (value: number, record: { cash_balance: number; holding_market_value: number }) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{formatDecimal(value)}</Typography.Text>
                  <Typography.Text type="secondary">
                    现金 {formatDecimal(record.cash_balance)} + 持仓 {formatDecimal(record.holding_market_value)}
                  </Typography.Text>
                </Space>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
