import {
  Alert,
  Button,
  Card,
  Col,
  Grid,
  Input,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { Account, DriftItem, Holding } from "../types";
import { formatDecimal, formatPercent } from "../utils/format";

type PnlFilter = "ALL" | "POSITIVE" | "NEGATIVE";
type DriftFilter = "ALL" | "ALERT_ONLY" | "NORMAL_ONLY";

function toNumber(value: string | number | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export default function HoldingsPage() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [nodeDrifts, setNodeDrifts] = useState<DriftItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [pnlFilter, setPnlFilter] = useState<PnlFilter>("ALL");
  const [driftKeyword, setDriftKeyword] = useState("");
  const [driftFilter, setDriftFilter] = useState<DriftFilter>("ALL");

  async function load() {
    setLoading(true);
    try {
      const [a, h, d] = await Promise.all([
        api.get<Account[]>("/accounts"),
        api.get<Holding[]>("/holdings"),
        api.get<DriftItem[]>("/rebalance/drift"),
      ]);
      setAccounts(a);
      setHoldings(h);
      setNodeDrifts(d);
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

  const totalMarketValue = holdings.reduce((sum, row) => sum + toNumber(row.market_value), 0);
  const totalCostValue = holdings.reduce((sum, row) => sum + toNumber(row.cost_value), 0);
  const totalPnl = holdings.reduce((sum, row) => sum + toNumber(row.unrealized_pnl), 0);

  const driftAlertCount = nodeDrifts.filter((item) => item.is_alerted).length;

  const accountNameMap = useMemo(() => new Map(accounts.map((item) => [item.id, item.name])), [accounts]);

  const topExposures = useMemo(
    () => [...holdings].sort((a, b) => toNumber(b.market_value) - toNumber(a.market_value)).slice(0, 4),
    [holdings]
  );

  const filteredHoldings = useMemo(() => {
    return holdings.filter((row) => {
      const byKeyword = keyword
        ? row.symbol.toLowerCase().includes(keyword.toLowerCase()) || row.instrument_name.toLowerCase().includes(keyword.toLowerCase())
        : true;
      const byAccount = accountFilter === "ALL" ? true : String(row.account_id) === accountFilter;
      const pnlNumber = toNumber(row.unrealized_pnl);
      const byPnl = pnlFilter === "ALL" ? true : pnlFilter === "POSITIVE" ? pnlNumber >= 0 : pnlNumber < 0;
      return byKeyword && byAccount && byPnl;
    });
  }, [holdings, keyword, accountFilter, pnlFilter]);

  const filteredMarketValue = useMemo(
    () => filteredHoldings.reduce((sum, item) => sum + toNumber(item.market_value), 0),
    [filteredHoldings]
  );
  const filteredPnl = useMemo(
    () => filteredHoldings.reduce((sum, item) => sum + toNumber(item.unrealized_pnl), 0),
    [filteredHoldings]
  );
  const filteredAccountsCount = useMemo(
    () => new Set(filteredHoldings.map((item) => item.account_id)).size,
    [filteredHoldings]
  );

  const filteredDrifts = useMemo(() => {
    return nodeDrifts.filter((row) => {
      const byKeyword = driftKeyword
        ? row.name.toLowerCase().includes(driftKeyword.toLowerCase())
        : true;
      if (driftFilter === "ALERT_ONLY") {
        return byKeyword && row.is_alerted;
      }
      if (driftFilter === "NORMAL_ONLY") {
        return byKeyword && !row.is_alerted;
      }
      return byKeyword;
    });
  }, [nodeDrifts, driftFilter, driftKeyword]);

  const holdingColumns: ColumnsType<Holding> = [
    {
      title: "账户",
      dataIndex: "account_id",
      width: 150,
      render: (value: number) => accountNameMap.get(value) ?? value,
      sorter: (a, b) => (accountNameMap.get(a.account_id) ?? "").localeCompare(accountNameMap.get(b.account_id) ?? "")
    },
    {
      title: "标的",
      dataIndex: "symbol",
      width: 120,
      sorter: (a, b) => a.symbol.localeCompare(b.symbol)
    },
    {
      title: "名称",
      dataIndex: "instrument_name",
      width: 180,
      ellipsis: true
    },
    {
      title: "数量",
      dataIndex: "quantity",
      width: 120,
      align: "right",
      render: (value: string) => formatDecimal(value),
      sorter: (a, b) => toNumber(a.quantity) - toNumber(b.quantity)
    },
    {
      title: "均价",
      dataIndex: "avg_cost",
      width: 120,
      align: "right",
      render: (value: string) => formatDecimal(value),
      sorter: (a, b) => toNumber(a.avg_cost) - toNumber(b.avg_cost)
    },
    {
      title: "市价",
      dataIndex: "market_price",
      width: 120,
      align: "right",
      render: (value: string) => formatDecimal(value),
      sorter: (a, b) => toNumber(a.market_price) - toNumber(b.market_price)
    },
    {
      title: "市值",
      dataIndex: "market_value",
      width: 140,
      align: "right",
      render: (value: string) => formatDecimal(value),
      sorter: (a, b) => toNumber(a.market_value) - toNumber(b.market_value)
    },
    {
      title: "占组合",
      dataIndex: "market_value",
      width: 110,
      align: "right",
      render: (value: string) => {
        const ratio = totalMarketValue > 0 ? (toNumber(value) / totalMarketValue) * 100 : 0;
        return formatPercent(ratio);
      }
    },
    {
      title: "成本",
      dataIndex: "cost_value",
      width: 140,
      align: "right",
      render: (value: string) => formatDecimal(value),
      sorter: (a, b) => toNumber(a.cost_value) - toNumber(b.cost_value)
    },
    {
      title: "浮盈亏",
      dataIndex: "unrealized_pnl",
      width: 140,
      align: "right",
      render: (value: string) => {
        const num = toNumber(value);
        return <Typography.Text style={{ color: num >= 0 ? "#1677ff" : "#ff4d4f" }}>{formatDecimal(value)}</Typography.Text>;
      },
      sorter: (a, b) => toNumber(a.unrealized_pnl) - toNumber(b.unrealized_pnl)
    },
    {
      title: "收益率",
      key: "return_rate",
      width: 120,
      align: "right",
      render: (_, row: Holding) => {
        const cost = toNumber(row.cost_value);
        const rate = cost > 0 ? (toNumber(row.unrealized_pnl) / cost) * 100 : 0;
        return <Typography.Text style={{ color: rate >= 0 ? "#1677ff" : "#ff4d4f" }}>{formatPercent(rate)}</Typography.Text>;
      },
      sorter: (a, b) => {
        const aCost = toNumber(a.cost_value);
        const bCost = toNumber(b.cost_value);
        const aRate = aCost > 0 ? (toNumber(a.unrealized_pnl) / aCost) * 100 : 0;
        const bRate = bCost > 0 ? (toNumber(b.unrealized_pnl) / bCost) * 100 : 0;
        return aRate - bRate;
      }
    },
    {
      title: "盈亏贡献",
      key: "pnl_contrib",
      width: 160,
      render: (_, row: Holding) => {
        const contribution = totalPnl === 0 ? 0 : (toNumber(row.unrealized_pnl) / totalPnl) * 100;
        return (
          <Space direction="vertical" size={2} style={{ width: 136 }}>
            <Progress
              percent={Math.min(100, Math.abs(contribution))}
              showInfo={false}
              strokeColor={contribution >= 0 ? "#52c41a" : "#ff4d4f"}
            />
            <Typography.Text type="secondary">{formatPercent(contribution)}</Typography.Text>
          </Space>
        );
      }
    }
  ];

  const driftColumns: ColumnsType<DriftItem> = [
    { title: "层级", dataIndex: "name", ellipsis: true },
    { title: "目标权重", dataIndex: "target_weight", align: "right", render: (value: string) => formatPercent(value) },
    { title: "实际权重", dataIndex: "actual_weight", align: "right", render: (value: string) => formatPercent(value) },
    {
      title: "偏离",
      dataIndex: "drift_pct",
      align: "right",
      render: (value: string) => {
        const numberValue = toNumber(value);
        return (
          <Typography.Text style={{ color: Math.abs(numberValue) >= 5 ? "#d46b08" : "#1f4f94" }}>
            {formatPercent(numberValue)}
          </Typography.Text>
        );
      }
    },
    {
      title: "强度",
      dataIndex: "drift_pct",
      width: 180,
      render: (value: string, row: DriftItem) => {
        const ratio = Math.min(100, (Math.abs(toNumber(value)) / 10) * 100);
        return <Progress percent={Number(ratio.toFixed(3))} showInfo={false} strokeColor={row.is_alerted ? "#fa8c16" : "#1f4f94"} />;
      }
    },
    {
      title: "状态",
      dataIndex: "is_alerted",
      width: 120,
      render: (value: boolean) => (value ? <Tag color="error">超阈值</Tag> : <Tag color="success">正常</Tag>)
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {error && <Alert type="error" showIcon message="请求失败" description={error} closable />}

      <div className="page-grid page-section">
        <Card>
          <Typography.Text type="secondary">组合市值</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8 }}>
            {formatDecimal(totalMarketValue)}
          </Typography.Title>
        </Card>
        <Card>
          <Typography.Text type="secondary">组合成本</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8 }}>
            {formatDecimal(totalCostValue)}
          </Typography.Title>
        </Card>
        <Card>
          <Typography.Text type="secondary">浮盈亏</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8, color: totalPnl >= 0 ? "#1677ff" : "#ff4d4f" }}>
            {formatDecimal(totalPnl)}
          </Typography.Title>
        </Card>
        <Card>
          <Typography.Text type="secondary">偏离提醒</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8 }}>
            {formatDecimal(driftAlertCount)}
          </Typography.Title>
        </Card>
      </div>

      <Card className="page-section" title="核心敞口" extra={<Tag color="blue">按市值 Top 4</Tag>}>
        <Row gutter={[12, 12]}>
          {topExposures.length === 0 && (
            <Col span={24}>
              <Typography.Text type="secondary">暂无持仓数据</Typography.Text>
            </Col>
          )}
          {topExposures.map((row) => {
            const share = totalMarketValue > 0 ? (toNumber(row.market_value) / totalMarketValue) * 100 : 0;
            return (
              <Col key={`${row.account_id}-${row.instrument_id}`} xs={24} sm={12} xl={6}>
                <Card size="small" className="holdings-exposure-item">
                  <Typography.Text type="secondary">
                    {row.symbol} · {accountNameMap.get(row.account_id) ?? row.account_id}
                  </Typography.Text>
                  <Typography.Title level={5} style={{ marginTop: 8, marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
                    {formatDecimal(row.market_value)}
                  </Typography.Title>
                  <Typography.Text type="secondary" ellipsis>
                    {row.instrument_name}
                  </Typography.Text>
                  <Progress percent={Math.min(100, Number(share.toFixed(3)))} showInfo={false} style={{ marginTop: 8 }} />
                  <Typography.Text type="secondary">占组合 {formatPercent(share)}</Typography.Text>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>

      <Card
        className="page-section"
        title="持仓明细"
        extra={
          <Button onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        }
      >
        <div className="holdings-filter-wrap">
          <div className="holdings-filter-grid">
            <Input
              placeholder="按标的代码或名称搜索"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              allowClear
            />
            <Select
              value={accountFilter}
              onChange={(value) => setAccountFilter(value)}
              options={[{ value: "ALL", label: "全部账户" }, ...accounts.map((item) => ({ value: String(item.id), label: item.name }))]}
            />
            <Segmented
              className="holdings-segmented-equal"
              value={pnlFilter}
              options={[
                { value: "ALL", label: "全部盈亏" },
                { value: "POSITIVE", label: "盈利/持平" },
                { value: "NEGATIVE", label: "亏损" }
              ]}
              onChange={(value) => setPnlFilter(value as PnlFilter)}
              block={isMobile}
            />
            <Button
              className="holdings-clear-btn"
              onClick={() => {
                setKeyword("");
                setAccountFilter("ALL");
                setPnlFilter("ALL");
              }}
            >
              清空筛选
            </Button>
          </div>

          <div className="holdings-filter-meta">
            <Tag color="blue">结果 {filteredHoldings.length} 条</Tag>
            <Tag color="geekblue">覆盖账户 {filteredAccountsCount} 个</Tag>
            <Tag color="cyan">筛选市值 {formatDecimal(filteredMarketValue)}</Tag>
            <Tag color={filteredPnl >= 0 ? "success" : "error"}>筛选浮盈亏 {formatDecimal(filteredPnl)}</Tag>
          </div>
        </div>

        <Table
          rowKey={(record) => `${record.account_id}-${record.instrument_id}`}
          loading={loading}
          size={isMobile ? "small" : "middle"}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 1540 }}
          dataSource={filteredHoldings}
          columns={holdingColumns}
        />
      </Card>

      <Card
        className="page-section"
        title="权重偏离"
        extra={
          <Tag color={filteredDrifts.filter((item) => item.is_alerted).length > 0 ? "warning" : "success"}>
            当前超阈值 {filteredDrifts.filter((item) => item.is_alerted).length}
          </Tag>
        }
      >
        <div className="holdings-filter-wrap">
          <div className="holdings-filter-grid holdings-drift-filter-grid">
            <Input
              placeholder="按层级名称筛选"
              value={driftKeyword}
              onChange={(event) => setDriftKeyword(event.target.value)}
              allowClear
            />
            <Segmented
              className="holdings-segmented-equal"
              value={driftFilter}
              onChange={(value) => setDriftFilter(value as DriftFilter)}
              options={[
                { value: "ALL", label: "全部偏离项" },
                { value: "ALERT_ONLY", label: "仅超阈值" },
                { value: "NORMAL_ONLY", label: "仅阈值内" }
              ]}
              block={isMobile}
            />
            <Button
              className="holdings-clear-btn"
              onClick={() => {
                setDriftKeyword("");
                setDriftFilter("ALL");
              }}
            >
              清空筛选
            </Button>
          </div>
        </div>

        <Table
          rowKey="node_id"
          loading={loading}
          size={isMobile ? "small" : "middle"}
          pagination={{ pageSize: isMobile ? 6 : 8, showSizeChanger: false }}
          scroll={{ x: 860 }}
          dataSource={filteredDrifts}
          columns={driftColumns}
        />
      </Card>
    </Space>
  );
}
