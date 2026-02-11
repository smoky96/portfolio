import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { ACCOUNT_TYPE_LABELS, INSTRUMENT_TYPE_LABELS } from "../constants/labels";
import { Account, Holding, Instrument, LatestQuote } from "../types";
import { formatDecimal } from "../utils/format";

interface CustomInstrumentForm {
  symbol: string;
  type: Instrument["type"];
  currency: string;
  name: string;
  default_account_id?: number;
}

interface InstrumentMetrics {
  quantity: number;
  avgCost: number | null;
  currentPrice: number | null;
  currentCurrency: string | null;
  currentSource: string | null;
}

interface InstrumentRow extends Instrument {
  quantity: number;
  avg_cost: number | null;
  current_price: number | null;
  current_price_currency: string | null;
  current_price_source: string | null;
}

const CURRENCY_OPTIONS = [
  { value: "CNY", label: "CNY - 人民币" },
  { value: "USD", label: "USD - 美元" },
  { value: "HKD", label: "HKD - 港币" },
  { value: "EUR", label: "EUR - 欧元" },
  { value: "GBP", label: "GBP - 英镑" },
  { value: "JPY", label: "JPY - 日元" },
  { value: "SGD", label: "SGD - 新加坡元" }
] as const;

const TYPE_OPTIONS = [
  { value: "STOCK", label: INSTRUMENT_TYPE_LABELS.STOCK },
  { value: "FUND", label: INSTRUMENT_TYPE_LABELS.FUND }
] as const;

function sourceTag(source: string | null) {
  if (!source) {
    return <Tag>无</Tag>;
  }
  if (source === "manual") {
    return <Tag color="gold">手动</Tag>;
  }
  if (source === "yahoo") {
    return <Tag color="blue">行情</Tag>;
  }
  return <Tag>{source}</Tag>;
}

export default function CustomInstrumentsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [latestQuotes, setLatestQuotes] = useState<LatestQuote[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [submittingPriceId, setSubmittingPriceId] = useState<number | null>(null);
  const [customKeyword, setCustomKeyword] = useState("");
  const [customPriceDrafts, setCustomPriceDrafts] = useState<Record<number, number | undefined>>({});
  const [customForm] = Form.useForm<CustomInstrumentForm>();

  async function load() {
    setLoading(true);
    try {
      const [a, h, i, q] = await Promise.all([
        api.get<Account[]>("/accounts"),
        api.get<Holding[]>("/holdings"),
        api.get<Instrument[]>("/instruments"),
        api.get<LatestQuote[]>("/quotes/latest")
      ]);
      setAccounts(a);
      setHoldings(h);
      setInstruments(i);
      setLatestQuotes(q);
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    customForm.setFieldsValue({ type: "STOCK", currency: "CNY" });
    void load();
  }, []);

  async function onCreateCustom(values: CustomInstrumentForm) {
    setCreatingCustom(true);
    try {
      await api.post<Instrument>("/instruments", {
        symbol: values.symbol.trim().toUpperCase(),
        market: "CUSTOM",
        type: values.type,
        currency: values.currency.trim().toUpperCase(),
        name: values.name.trim(),
        default_account_id: values.default_account_id ?? null
      });
      message.success("自定义标的已创建");
      customForm.resetFields();
      customForm.setFieldsValue({ type: "STOCK", currency: "CNY" });
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreatingCustom(false);
    }
  }

  async function onUpdateCustomPrice(row: InstrumentRow) {
    const price = customPriceDrafts[row.id];
    if (!price || price <= 0) {
      message.error("请输入大于 0 的现价");
      return;
    }

    setSubmittingPriceId(row.id);
    try {
      await api.post("/quotes/manual-overrides", {
        instrument_id: row.id,
        price,
        currency: row.currency,
        overridden_at: new Date().toISOString(),
        reason: "自定义标的手动更新现价"
      });
      message.success("现价已更新");
      setCustomPriceDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmittingPriceId(null);
    }
  }

  const accountNameMap = useMemo(() => new Map(accounts.map((item) => [item.id, item.name])), [accounts]);

  const metricMap = useMemo(() => {
    const qtyMap = new Map<number, { quantity: number; costAmount: number }>();
    holdings.forEach((item) => {
      const instrumentId = item.instrument_id;
      const qty = Number(item.quantity);
      const avgCost = Number(item.avg_cost);
      const current = qtyMap.get(instrumentId) ?? { quantity: 0, costAmount: 0 };
      current.quantity += qty;
      current.costAmount += qty * avgCost;
      qtyMap.set(instrumentId, current);
    });

    const quoteMap = new Map(latestQuotes.map((item) => [item.instrument_id, item]));
    const map = new Map<number, InstrumentMetrics>();

    instruments.forEach((instrument) => {
      const holdingInfo = qtyMap.get(instrument.id);
      const quantity = holdingInfo?.quantity ?? 0;
      const avgCost = quantity > 0 ? holdingInfo!.costAmount / quantity : null;
      const quote = quoteMap.get(instrument.id);

      map.set(instrument.id, {
        quantity,
        avgCost,
        currentPrice: quote?.price ? Number(quote.price) : null,
        currentCurrency: quote?.currency ?? null,
        currentSource: quote?.source ?? null
      });
    });

    return map;
  }, [instruments, holdings, latestQuotes]);

  const customRows = useMemo(() => {
    const rows = instruments
      .filter((item) => item.market === "CUSTOM")
      .map<InstrumentRow>((item) => {
        const metric = metricMap.get(item.id);
        return {
          ...item,
          quantity: metric?.quantity ?? 0,
          avg_cost: metric?.avgCost ?? null,
          current_price: metric?.currentPrice ?? null,
          current_price_currency: metric?.currentCurrency ?? null,
          current_price_source: metric?.currentSource ?? null
        };
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol, "en-US", { sensitivity: "base" }));

    if (!customKeyword) {
      return rows;
    }
    const keyword = customKeyword.toLowerCase();
    return rows.filter((item) => item.symbol.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword));
  }, [instruments, metricMap, customKeyword]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }} className="page-stack custom-instruments-page">
      {error && <Alert type="error" showIcon message="请求失败" description={error} closable />}

      <Card className="page-section custom-create-card" title="新增自定义标的">
        <Form<CustomInstrumentForm> layout="vertical" form={customForm} onFinish={(values) => void onCreateCustom(values)}>
          <div className="page-grid">
            <Form.Item label="标的代码" name="symbol" rules={[{ required: true, message: "请输入标的代码" }]}>
              <Input placeholder="如 CUST_GOLD_01" />
            </Form.Item>
            <Form.Item label="标的名称" name="name" rules={[{ required: true, message: "请输入标的名称" }]}>
              <Input placeholder="如 黄金策略组合" />
            </Form.Item>
            <Form.Item label="标的类型" name="type" rules={[{ required: true, message: "请选择标的类型" }]}>
              <Select options={TYPE_OPTIONS.map((item) => ({ ...item }))} />
            </Form.Item>
            <Form.Item label="币种" name="currency" rules={[{ required: true, message: "请选择币种" }]}>
              <Select options={CURRENCY_OPTIONS.map((item) => ({ ...item }))} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item label="默认账户" name="default_account_id">
              <Select
                allowClear
                placeholder="可选"
                options={accounts.map((account) => ({
                  value: account.id,
                  label: `${account.name} (${ACCOUNT_TYPE_LABELS[account.type]})`
                }))}
              />
            </Form.Item>
          </div>
          <Space style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" loading={creatingCustom}>
              创建自定义标的
            </Button>
            <Button onClick={() => void load()} loading={loading}>
              刷新
            </Button>
          </Space>
        </Form>
      </Card>

      <Card className="page-section custom-list-card" title="自定义标的一览">
        <div className="page-toolbar custom-instruments-toolbar">
          <Input
            placeholder="按代码或名称搜索"
            value={customKeyword}
            onChange={(event) => setCustomKeyword(event.target.value)}
            allowClear
            style={{ maxWidth: 260 }}
          />
          <Button onClick={() => setCustomKeyword("")}>清空筛选</Button>
        </div>

        <Table
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1320 }}
          dataSource={customRows}
          columns={[
            { title: "标的代码", dataIndex: "symbol", width: 150 },
            { title: "标的名称", dataIndex: "name", width: 190 },
            {
              title: "标的类型",
              dataIndex: "type",
              width: 120,
              render: (value: Instrument["type"]) => (
                <Tag color={value === "STOCK" ? "blue" : "purple"}>{INSTRUMENT_TYPE_LABELS[value]}</Tag>
              )
            },
            { title: "币种", dataIndex: "currency", width: 100 },
            {
              title: "持仓成本",
              width: 220,
              render: (_: unknown, record: InstrumentRow) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.avg_cost === null ? "-" : formatDecimal(record.avg_cost)}</Typography.Text>
                  <Typography.Text type="secondary">持仓数量 {formatDecimal(record.quantity)}</Typography.Text>
                </Space>
              )
            },
            {
              title: "现价",
              width: 210,
              render: (_: unknown, record: InstrumentRow) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>
                    {record.current_price === null ? "-" : `${formatDecimal(record.current_price)} ${record.current_price_currency ?? ""}`}
                  </Typography.Text>
                  {sourceTag(record.current_price_source)}
                </Space>
              )
            },
            {
              title: "更新净值",
              width: 260,
              render: (_: unknown, record: InstrumentRow) => (
                <Space>
                  <InputNumber
                    min={0}
                    precision={3}
                    value={customPriceDrafts[record.id]}
                    onChange={(value) =>
                      setCustomPriceDrafts((prev) => ({
                        ...prev,
                        [record.id]: value === null ? undefined : value
                      }))
                    }
                    placeholder="输入净值"
                    style={{ width: 120 }}
                  />
                  <Button
                    type="primary"
                    size="small"
                    loading={submittingPriceId === record.id}
                    onClick={() => void onUpdateCustomPrice(record)}
                  >
                    保存
                  </Button>
                </Space>
              )
            },
            {
              title: "默认账户",
              dataIndex: "default_account_id",
              width: 180,
              render: (value: number | null) => (value ? accountNameMap.get(value) ?? "-" : "-")
            }
          ]}
        />
      </Card>
    </Space>
  );
}
