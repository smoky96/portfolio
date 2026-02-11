import { Alert, Card, Checkbox, Col, Row, Select, Space, Tag, Typography } from "antd";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import {
  AllocationTag,
  AllocationTagGroup,
  AllocationNode,
  DashboardSummary,
  DriftItem,
  Holding,
  Instrument,
  InstrumentTagSelection,
  ReturnCurvePoint
} from "../types";
import { formatDecimal, formatPercent } from "../utils/format";

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

const CHART_COLORS = [
  "#1f4f94",
  "#3a6fb8",
  "#59b85f",
  "#f29f3f",
  "#8a9ec2",
  "#5c7f95",
  "#4f8f7d",
  "#9264de",
  "#d96a5f",
  "#2b5d8c"
];

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function buildDonutOption(params: { slices: PieSlice[]; centerLabel: string; centerAmount: number }): EChartsOption | null {
  const validSlices = params.slices.filter((slice) => Number.isFinite(slice.value) && slice.value > 0.0001);
  if (!validSlices.length) {
    return null;
  }

  const centerAmount = Number.isFinite(params.centerAmount) ? params.centerAmount : 0;

  return {
    animationDuration: 450,
    tooltip: {
      trigger: "item",
      formatter: (value: unknown) => {
        const item = value as { name: string; value: number };
        return `${item.name}<br/>占比 ${formatPercent(item.value)}`;
      }
    },
    title: [
      {
        text: params.centerLabel,
        left: "center",
        top: "39%",
        textStyle: {
          fontSize: 12,
          fontWeight: 600,
          color: "#6b7280"
        }
      },
      {
        text: formatDecimal(centerAmount),
        left: "center",
        top: "49%",
        textStyle: {
          fontSize: 20,
          fontWeight: 700,
          color: "#111827",
          fontFamily: "DIN Alternate, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
        }
      }
    ],
    series: [
      {
        type: "pie",
        radius: ["60%", "76%"],
        center: ["50%", "43%"],
        startAngle: 90,
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: {
          borderColor: "#ffffff",
          borderWidth: 2
        },
        emphasis: {
          scale: false
        },
        data: validSlices.map((slice) => ({
          name: slice.label,
          value: Number(slice.value.toFixed(6)),
          itemStyle: { color: slice.color }
        }))
      }
    ]
  };
}

function buildCurveOption(points: ReturnCurvePoint[]): EChartsOption | null {
  const series = points
    .map((item) => ({
      date: item.date,
      rate: item.total_return_rate === null ? null : Number(item.total_return_rate)
    }))
    .filter((item): item is { date: string; rate: number } => item.rate !== null && Number.isFinite(item.rate));

  if (series.length < 2) {
    return null;
  }

  const values = series.map((item) => Number(item.rate.toFixed(6)));
  const dates = series.map((item) => formatShortDate(item.date));
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const range = Math.max(maxValue - minValue, 0.0001);
  const padding = range * 0.15;
  const yMaxRaw = maxValue + padding;
  const yMinRaw = minValue - padding;
  const yMax = Number((yMaxRaw + (Math.abs(yMaxRaw - yMinRaw) < 0.001 ? 0.001 : 0)).toFixed(3));
  const yMin = Number(yMinRaw.toFixed(3));

  return {
    animationDuration: 500,
    grid: {
      left: 56,
      right: 20,
      top: 16,
      bottom: 34
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
        lineStyle: { color: "#9fb5d4" }
      },
      valueFormatter: (value: unknown) => formatPercent(typeof value === "number" ? value : Number(value))
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: dates,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#dce4f2" } },
      axisLabel: {
        color: "#8c8c8c",
        fontSize: 10
      }
    },
    yAxis: {
      type: "value",
      min: yMin,
      max: yMax,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "#8c8c8c",
        fontSize: 10,
        formatter: (value: number) => formatPercent(value)
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
        data: values,
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
              { offset: 0, color: "rgba(31, 79, 148, 0.28)" },
              { offset: 1, color: "rgba(31, 79, 148, 0.04)" }
            ]
          }
        }
      }
    ]
  };
}

function buildDriftOption(items: DriftItem[]): EChartsOption | null {
  if (!items.length) {
    return null;
  }

  const values = items.map((item) => Math.abs(Number(item.drift_pct)));
  const maxValue = Math.max(...values, 1);

  return {
    animationDuration: 450,
    grid: {
      left: 16,
      right: 24,
      top: 10,
      bottom: 10,
      containLabel: true
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const list = params as Array<{ axisValue: string; value: number }>;
        const item = Array.isArray(list) ? list[0] : (list as unknown as { axisValue: string; value: number });
        return `${item.axisValue}<br/>偏离 ${formatPercent(item.value)}`;
      }
    },
    xAxis: {
      type: "value",
      min: 0,
      max: Number((maxValue * 1.1).toFixed(3)),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { show: false },
      splitLine: {
        lineStyle: { color: "#edf2fb" }
      }
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: items.map((item) => item.name),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: "#374151",
        fontSize: 12,
        width: 120,
        overflow: "truncate"
      }
    },
    series: [
      {
        type: "bar",
        barWidth: 10,
        data: values,
        itemStyle: {
          color: (params: unknown) => {
            const item = params as { value: number };
            return Number(item.value) > 5 ? "#d9363e" : "#1f4f94";
          },
          borderRadius: [0, 6, 6, 0]
        },
        label: {
          show: true,
          position: "right",
          color: "#1f2937",
          fontSize: 11,
          fontWeight: 600,
          formatter: (value: unknown) => {
            const item = value as { value: number };
            return formatPercent(item.value);
          }
        }
      }
    ]
  };
}

function getRootNode(nodeId: number, nodeMap: Map<number, AllocationNode>): AllocationNode | null {
  let current = nodeMap.get(nodeId) ?? null;
  if (!current) {
    return null;
  }
  while (current.parent_id !== null) {
    const parent = nodeMap.get(current.parent_id);
    if (!parent) {
      break;
    }
    current = parent;
  }
  return current;
}

function buildAllocationNodePath(node: AllocationNode, nodeMap: Map<number, AllocationNode>): string {
  const path: string[] = [node.name];
  let parentId = node.parent_id;
  while (parentId !== null) {
    const parent = nodeMap.get(parentId);
    if (!parent) {
      break;
    }
    path.unshift(parent.name);
    parentId = parent.parent_id;
  }
  return path.join(" / ");
}

function getDirectChildUnderNode(leafNodeId: number, ancestorId: number, nodeMap: Map<number, AllocationNode>): AllocationNode | null {
  let current = nodeMap.get(leafNodeId) ?? null;
  if (!current) {
    return null;
  }
  while (current.parent_id !== null) {
    if (current.parent_id === ancestorId) {
      return current;
    }
    const parent = nodeMap.get(current.parent_id);
    if (!parent) {
      break;
    }
    current = parent;
  }
  return null;
}

function aggregateAssetStructureByNode(
  holdings: Holding[],
  instruments: Instrument[],
  nodes: AllocationNode[],
  totalAssets: number,
  totalCash: number,
  focusNodeId: number | null,
  includeRootCash: boolean
): {
  slices: PieSlice[];
  centerLabel: string;
  centerAmount: number;
  levelPath: string;
} {
  const nodeMap = new Map(nodes.map((item) => [item.id, item]));
  const instrumentMap = new Map(instruments.map((item) => [item.id, item]));
  const branchNodeIds = new Set(nodes.filter((item) => item.parent_id !== null).map((item) => item.parent_id as number));
  const valueMap = new Map<string, number>();
  const focusNode = focusNodeId === null ? null : nodeMap.get(focusNodeId) ?? null;
  const focusIsLeaf = focusNode ? !branchNodeIds.has(focusNode.id) : false;

  const addAmount = (label: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    valueMap.set(label, (valueMap.get(label) ?? 0) + value);
  };

  for (const holding of holdings) {
    const value = Number(holding.market_value || 0);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }

    const instrument = instrumentMap.get(holding.instrument_id);
    if (!instrument || instrument.allocation_node_id === null) {
      addAmount("未配置标的", value);
      continue;
    }

    const leafNode = nodeMap.get(instrument.allocation_node_id);
    if (!leafNode) {
      addAmount("未配置标的", value);
      continue;
    }

    if (focusNode === null) {
      const root = getRootNode(leafNode.id, nodeMap);
      addAmount(root?.name ?? leafNode.name, value);
      continue;
    }

    if (focusIsLeaf) {
      if (leafNode.id === focusNode.id) {
        addAmount(holding.symbol, value);
      }
      continue;
    }

    const directChild = getDirectChildUnderNode(leafNode.id, focusNode.id, nodeMap);
    if (directChild) {
      addAmount(directChild.name, value);
    }
  }

  let denominator = 0;
  let centerAmount = 0;
  let centerLabel = "总资产";
  let levelPath = "全部资产";

  if (focusNode === null) {
    if (includeRootCash) {
      addAmount("账户现金", totalCash);
    }
    const assignedTotal = [...valueMap.values()].reduce((sum, value) => sum + value, 0);
    const denominatorBase = includeRootCash ? totalAssets : Math.max(totalAssets - totalCash, 0);
    const remaining = denominatorBase - assignedTotal;
    if (remaining > 0.0001) {
      addAmount("未归集", remaining);
    }
    denominator = denominatorBase;
    centerAmount = denominatorBase;
    centerLabel = includeRootCash ? "总资产" : "非现金资产";
  } else {
    denominator = [...valueMap.values()].reduce((sum, value) => sum + value, 0);
    centerAmount = denominator;
    centerLabel = focusNode.name;
    levelPath = buildAllocationNodePath(focusNode, nodeMap);
  }

  if (denominator <= 0.0001) {
    return {
      slices: [],
      centerLabel,
      centerAmount,
      levelPath
    };
  }

  const sorted = [...valueMap.entries()].sort((a, b) => b[1] - a[1]);
  return {
    slices: sorted.map(([label, amount], index) => ({
      label,
      value: Number(((amount / denominator) * 100).toFixed(6)),
      color: CHART_COLORS[index % CHART_COLORS.length]
    })),
    centerLabel,
    centerAmount,
    levelPath
  };
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [curve, setCurve] = useState<ReturnCurvePoint[]>([]);
  const [allocationNodes, setAllocationNodes] = useState<AllocationNode[]>([]);
  const [tagGroups, setTagGroups] = useState<AllocationTagGroup[]>([]);
  const [tags, setTags] = useState<AllocationTag[]>([]);
  const [instrumentTagSelections, setInstrumentTagSelections] = useState<InstrumentTagSelection[]>([]);
  const [driftItems, setDriftItems] = useState<DriftItem[]>([]);
  const [activeAssetNodeId, setActiveAssetNodeId] = useState<number | null>(null);
  const [showRootCashInAssetPie, setShowRootCashInAssetPie] = useState(true);
  const [activeTagGroupId, setActiveTagGroupId] = useState<number | null>(null);
  const [showUntaggedInTagPie, setShowUntaggedInTagPie] = useState(true);
  const [curveDays, setCurveDays] = useState<number>(180);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(days = curveDays) {
    setLoading(true);
    try {
      const [summaryResp, holdingsResp, instrumentsResp, curveResp, nodesResp, groupsResp, tagsResp, selectionsResp, driftResp] = await Promise.all([
        api.get<DashboardSummary>("/dashboard/summary"),
        api.get<Holding[]>("/holdings"),
        api.get<Instrument[]>("/instruments"),
        api.get<ReturnCurvePoint[]>(`/dashboard/returns-curve?days=${days}`),
        api.get<AllocationNode[]>("/allocation/nodes"),
        api.get<AllocationTagGroup[]>("/allocation/tag-groups"),
        api.get<AllocationTag[]>("/allocation/tags"),
        api.get<InstrumentTagSelection[]>("/allocation/instrument-tags"),
        api.get<DriftItem[]>("/rebalance/drift")
      ]);
      setSummary(summaryResp);
      setHoldings(holdingsResp);
      setInstruments(instrumentsResp);
      setCurve(curveResp);
      setAllocationNodes(nodesResp);
      setTagGroups(groupsResp);
      setTags(tagsResp);
      setInstrumentTagSelections(selectionsResp);
      setDriftItems(driftResp);
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(curveDays);
  }, [curveDays]);

  useEffect(() => {
    if (tagGroups.length === 0) {
      setActiveTagGroupId(null);
      return;
    }
    if (!activeTagGroupId || !tagGroups.some((item) => item.id === activeTagGroupId)) {
      setActiveTagGroupId(tagGroups[0].id);
    }
  }, [tagGroups, activeTagGroupId]);

  useEffect(() => {
    if (activeAssetNodeId === null) {
      return;
    }
    if (!allocationNodes.some((item) => item.id === activeAssetNodeId)) {
      setActiveAssetNodeId(null);
    }
  }, [allocationNodes, activeAssetNodeId]);

  const allocationNodeMap = useMemo(() => new Map(allocationNodes.map((item) => [item.id, item])), [allocationNodes]);
  const assetNodeOptions = useMemo(() => {
    const options = allocationNodes
      .map((item) => ({
        value: item.id,
        label: buildAllocationNodePath(item, allocationNodeMap)
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN", { sensitivity: "base" }));
    return [{ value: "ROOT", label: "全部资产" }, ...options];
  }, [allocationNodes, allocationNodeMap]);

  const assetStructure = useMemo(() => {
    if (!summary) {
      return {
        slices: [] as PieSlice[],
        centerLabel: "总资产",
        centerAmount: 0,
        levelPath: "全部资产"
      };
    }
    return aggregateAssetStructureByNode(
      holdings,
      instruments,
      allocationNodes,
      Number(summary.total_assets || 0),
      Number(summary.total_cash || 0),
      activeAssetNodeId,
      showRootCashInAssetPie
    );
  }, [summary, holdings, instruments, allocationNodes, activeAssetNodeId, showRootCashInAssetPie]);

  const derived = useMemo(() => {
    if (!summary) {
      return {
        alertedCount: 0,
        topDrifts: [] as DriftItem[],
        totalPnl: 0,
        totalCostValue: 0,
        netContribution: 0,
        totalReturn: 0,
        totalReturnRate: null as number | null,
        floatingPnlRate: null as number | null,
        gainers: [] as Holding[],
        losers: [] as Holding[],
        latestRate: null as number | null,
        peakRate: null as number | null,
        maxDrawdown: null as number | null,
        tagGroupSlices: [] as PieSlice[],
        activeTagGroupName: "",
        tagGroupDisplayTotal: 0
      };
    }

    const totalAssets = Number(summary.total_assets || 0);
    const totalCash = Number(summary.total_cash || 0);

    const alertedCount = driftItems.filter((item) => item.is_alerted).length;
    const topDrifts = [...driftItems]
      .sort((a, b) => Math.abs(Number(b.drift_pct)) - Math.abs(Number(a.drift_pct)))
      .slice(0, 5);

    const totalPnl = holdings.reduce((sum, row) => sum + Number(row.unrealized_pnl || 0), 0);
    const totalCostValue = holdings.reduce((sum, row) => sum + Number(row.cost_value || 0), 0);
    const lastCurvePoint = curve.length ? curve[curve.length - 1] : null;
    const netContribution = lastCurvePoint ? Number(lastCurvePoint.net_contribution || 0) : 0;
    const totalReturn = lastCurvePoint ? Number(lastCurvePoint.total_return || 0) : totalAssets - netContribution;
    const totalReturnRate =
      lastCurvePoint && lastCurvePoint.total_return_rate !== null ? Number(lastCurvePoint.total_return_rate) : null;
    const floatingPnlRate = totalCostValue > 0 ? (totalPnl / totalCostValue) * 100 : null;

    const gainers = [...holdings]
      .filter((item) => Number(item.unrealized_pnl || 0) > 0)
      .sort((a, b) => Number(b.unrealized_pnl || 0) - Number(a.unrealized_pnl || 0))
      .slice(0, 3);
    const losers = [...holdings]
      .filter((item) => Number(item.unrealized_pnl || 0) < 0)
      .sort((a, b) => Number(a.unrealized_pnl || 0) - Number(b.unrealized_pnl || 0))
      .slice(0, 3);

    const curveRates = curve
      .map((item) => (item.total_return_rate === null ? null : Number(item.total_return_rate)))
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const latestRate = curveRates.length ? curveRates[curveRates.length - 1] : null;
    const peakRate = curveRates.length ? Math.max(...curveRates) : null;

    let runningPeak = 0;
    let maxDrawdown = 0;
    for (const point of curve) {
      const assets = Number(point.total_assets || 0);
      if (assets > runningPeak) {
        runningPeak = assets;
      }
      if (runningPeak > 0) {
        const drawdown = ((assets - runningPeak) / runningPeak) * 100;
        if (drawdown < maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }

    const activeTagGroup = activeTagGroupId ? tagGroups.find((item) => item.id === activeTagGroupId) ?? null : null;
    const activeTagGroupTags = activeTagGroup
      ? tags
          .filter((item) => item.group_id === activeTagGroup.id)
          .sort((a, b) => a.order_index - b.order_index || a.id - b.id)
      : [];
    const activeTagGroupTagIds = new Set(activeTagGroupTags.map((item) => item.id));
    const selectionMap = new Map<number, number>();
    if (activeTagGroup) {
      instrumentTagSelections
        .filter((item) => item.group_id === activeTagGroup.id)
        .forEach((item) => selectionMap.set(item.instrument_id, item.tag_id));
    }

    const holdingsByInstrument = new Map<number, number>();
    holdings.forEach((item) => {
      const value = Number(item.market_value || 0);
      holdingsByInstrument.set(item.instrument_id, (holdingsByInstrument.get(item.instrument_id) ?? 0) + value);
    });

    const labelValueMap = new Map<string, number>();
    let taggedTotal = 0;
    let untaggedTotal = 0;
    if (activeTagGroup) {
      for (const [instrumentId, value] of holdingsByInstrument.entries()) {
        const tagId = selectionMap.get(instrumentId);
        if (!tagId || !activeTagGroupTagIds.has(tagId)) {
          untaggedTotal += value;
          if (showUntaggedInTagPie) {
            labelValueMap.set("未标记", (labelValueMap.get("未标记") ?? 0) + value);
          }
          continue;
        }
        const tag = activeTagGroupTags.find((item) => item.id === tagId);
        if (!tag) {
          untaggedTotal += value;
          if (showUntaggedInTagPie) {
            labelValueMap.set("未标记", (labelValueMap.get("未标记") ?? 0) + value);
          }
          continue;
        }
        taggedTotal += value;
        labelValueMap.set(tag.name, (labelValueMap.get(tag.name) ?? 0) + value);
      }
    }
    const tagGroupDisplayTotal = showUntaggedInTagPie ? taggedTotal + untaggedTotal : taggedTotal;

    const tagGroupSlices = [...labelValueMap.entries()]
      .map(([label, value], index) => ({
        label,
        value: tagGroupDisplayTotal > 0 ? Number(((value / tagGroupDisplayTotal) * 100).toFixed(6)) : 0,
        color: label === "未标记" ? "#d9d9d9" : CHART_COLORS[index % CHART_COLORS.length]
      }))
      .filter((item) => item.value > 0.0001)
      .sort((a, b) => b.value - a.value);

    return {
      alertedCount,
      topDrifts,
      totalPnl,
      totalCostValue,
      netContribution,
      totalReturn,
      totalReturnRate,
      floatingPnlRate,
      gainers,
      losers,
      latestRate,
      peakRate,
      maxDrawdown: curve.length ? maxDrawdown : null,
      tagGroupSlices,
      activeTagGroupName: activeTagGroup?.name ?? "",
      tagGroupDisplayTotal
    };
  }, [summary, holdings, curve, driftItems, activeTagGroupId, tagGroups, tags, instrumentTagSelections, showUntaggedInTagPie]);

  const curveChartOption = useMemo(() => buildCurveOption(curve), [curve]);
  const rootChartOption = useMemo(
    () => buildDonutOption({ slices: assetStructure.slices, centerLabel: assetStructure.centerLabel, centerAmount: assetStructure.centerAmount }),
    [assetStructure.slices, assetStructure.centerLabel, assetStructure.centerAmount]
  );
  const tagGroupChartOption = useMemo(
    () => buildDonutOption({ slices: derived.tagGroupSlices, centerLabel: "当前标签总额", centerAmount: derived.tagGroupDisplayTotal }),
    [derived.tagGroupSlices, derived.tagGroupDisplayTotal]
  );
  const driftChartOption = useMemo(() => buildDriftOption(derived.topDrifts), [derived.topDrifts]);

  if (!summary) {
    return (
      <Space direction="vertical" style={{ width: "100%" }} className="page-stack dashboard-page">
        {error && <Alert type="error" message="加载失败" description={error} showIcon />}
        <Card loading={loading} />
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }} className="page-stack dashboard-page">
      {error && <Alert type="error" message="请求失败" description={error} showIcon closable />}

      <div className="dashboard-kpi-grid page-section">
        <Card className="dashboard-kpi-card">
          <Typography.Text type="secondary" className="kpi-label">总资产 ({summary.base_currency})</Typography.Text>
          <Typography.Title level={3} className="kpi-value">
            {formatDecimal(summary.total_assets)}
          </Typography.Title>
        </Card>
        <Card className="dashboard-kpi-card">
          <Typography.Text type="secondary" className="kpi-label">净资金投入</Typography.Text>
          <Typography.Title level={3} className="kpi-value">
            {formatDecimal(derived.netContribution)}
          </Typography.Title>
        </Card>
        <Card className="dashboard-kpi-card">
          <Typography.Text type="secondary" className="kpi-label">累计收益</Typography.Text>
          <Typography.Title level={3} className="kpi-value" style={{ color: derived.totalReturn >= 0 ? "#1f4f94" : "#d9363e" }}>
            {formatDecimal(derived.totalReturn)}
          </Typography.Title>
        </Card>
        <Card className="dashboard-kpi-card">
          <Typography.Text type="secondary" className="kpi-label">累计收益率</Typography.Text>
          <Typography.Title level={3} className="kpi-value" style={{ color: (derived.totalReturnRate ?? 0) >= 0 ? "#1f4f94" : "#d9363e" }}>
            {derived.totalReturnRate === null ? "-" : formatPercent(derived.totalReturnRate)}
          </Typography.Title>
        </Card>
        <Card className="dashboard-kpi-card">
          <Typography.Text type="secondary" className="kpi-label">未实现盈亏</Typography.Text>
          <Typography.Title level={3} className="kpi-value" style={{ color: derived.totalPnl >= 0 ? "#1f4f94" : "#d9363e" }}>
            {formatDecimal(derived.totalPnl)}
          </Typography.Title>
        </Card>
        <Card className="dashboard-kpi-card">
          <Typography.Text type="secondary" className="kpi-label">浮动收益率</Typography.Text>
          <Typography.Title level={3} className="kpi-value" style={{ color: (derived.floatingPnlRate ?? 0) >= 0 ? "#1f4f94" : "#d9363e" }}>
            {derived.floatingPnlRate === null ? "-" : formatPercent(derived.floatingPnlRate)}
          </Typography.Title>
        </Card>
      </div>

      <Row gutter={[16, 16]} className="page-section dashboard-hero-row">
        <Col xs={24} xl={16}>
          <Card
            title="收益率曲线"
            className="dashboard-curve-card"
            extra={
              <Select
                size="small"
                value={curveDays}
                style={{ width: 140 }}
                onChange={(value: number) => setCurveDays(value)}
                options={[
                  { value: 30, label: "近 30 天" },
                  { value: 90, label: "近 90 天" },
                  { value: 180, label: "近 180 天" },
                  { value: 365, label: "近 1 年" }
                ]}
              />
            }
          >
            {curveChartOption ? (
              <div className="chart-frame chart-frame-curve">
                <ReactECharts option={curveChartOption} notMerge lazyUpdate className="dashboard-echart dashboard-echart-curve" />
              </div>
            ) : (
              <Typography.Text type="secondary">数据不足，暂无法绘制收益率曲线。</Typography.Text>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card title="收益快照" className="dashboard-snapshot-card">
            <Space direction="vertical" style={{ width: "100%" }} size={10}>
              <div className="snapshot-row">
                <Typography.Text type="secondary">当前收益率</Typography.Text>
                <Tag color={(derived.latestRate ?? 0) >= 0 ? "success" : "error"}>{derived.latestRate === null ? "-" : formatPercent(derived.latestRate)}</Tag>
              </div>
              <div className="snapshot-row">
                <Typography.Text type="secondary">区间峰值</Typography.Text>
                <Tag color="processing">{derived.peakRate === null ? "-" : formatPercent(derived.peakRate)}</Tag>
              </div>
              <div className="snapshot-row">
                <Typography.Text type="secondary">最大回撤</Typography.Text>
                <Tag color={(derived.maxDrawdown ?? 0) < 0 ? "warning" : "success"}>{derived.maxDrawdown === null ? "-" : formatPercent(derived.maxDrawdown)}</Tag>
              </div>
              <div className="snapshot-row">
                <Typography.Text type="secondary">超阈值偏离</Typography.Text>
                <Tag color={derived.alertedCount > 0 ? "error" : "success"}>{formatDecimal(derived.alertedCount)}</Tag>
              </div>

              <div>
                <Typography.Text type="secondary">盈利 Top 3</Typography.Text>
                <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 6 }}>
                  {derived.gainers.length === 0 && <Typography.Text type="secondary">暂无盈利持仓</Typography.Text>}
                  {derived.gainers.map((row) => (
                    <div key={`${row.account_id}-${row.instrument_id}`} className="snapshot-row">
                      <Typography.Text>{row.symbol}</Typography.Text>
                      <Tag color="success">{formatDecimal(row.unrealized_pnl)}</Tag>
                    </div>
                  ))}
                </Space>
              </div>

              <div>
                <Typography.Text type="secondary">亏损 Top 3</Typography.Text>
                <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 6 }}>
                  {derived.losers.length === 0 && <Typography.Text type="secondary">暂无亏损持仓</Typography.Text>}
                  {derived.losers.map((row) => (
                    <div key={`${row.account_id}-${row.instrument_id}`} className="snapshot-row">
                      <Typography.Text>{row.symbol}</Typography.Text>
                      <Tag color="error">{formatDecimal(row.unrealized_pnl)}</Tag>
                    </div>
                  ))}
                </Space>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="page-section dashboard-chart-row">
        <Col xs={24} md={12} xl={8}>
          <Card
            title="资产结构"
            className="dashboard-pie-card dashboard-asset-card"
            extra={
              <Select
                size="small"
                style={{ width: 180 }}
                value={activeAssetNodeId ?? "ROOT"}
                options={assetNodeOptions}
                onChange={(value) => setActiveAssetNodeId(value === "ROOT" ? null : Number(value))}
              />
            }
          >
            {rootChartOption ? (
              <ReactECharts option={rootChartOption} notMerge lazyUpdate className="dashboard-echart dashboard-echart-pie" />
            ) : (
              <div className="chart-empty">暂无可展示数据</div>
            )}
            {activeAssetNodeId === null && (
              <Checkbox checked={showRootCashInAssetPie} onChange={(event) => setShowRootCashInAssetPie(event.target.checked)}>
                显示账户现金
              </Checkbox>
            )}
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {assetStructure.slices.map((slice) => (
                <div key={slice.label} className="donut-legend-item">
                  <span className="donut-legend-dot" style={{ backgroundColor: slice.color }} />
                  <Typography.Text>{slice.label}</Typography.Text>
                  <Typography.Text className="metric-value">{formatPercent(slice.value)}</Typography.Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card
            title="标签持仓占比"
            className="dashboard-pie-card dashboard-tag-card"
            extra={
              <Select
                size="small"
                style={{ width: 160 }}
                value={activeTagGroupId ?? undefined}
                placeholder="选择标签组"
                options={tagGroups.map((item) => ({ value: item.id, label: item.name }))}
                onChange={(value: number) => setActiveTagGroupId(value)}
                disabled={tagGroups.length === 0}
              />
            }
          >
            {tagGroups.length === 0 ? (
              <div className="chart-empty">请先在标签组页面创建标签组</div>
            ) : tagGroupChartOption ? (
              <ReactECharts option={tagGroupChartOption} notMerge lazyUpdate className="dashboard-echart dashboard-echart-pie" />
            ) : (
              <div className="chart-empty">{showUntaggedInTagPie ? "当前标签组暂无可展示持仓" : "当前标签组暂无已标记持仓"}</div>
            )}
            <Checkbox checked={showUntaggedInTagPie} onChange={(event) => setShowUntaggedInTagPie(event.target.checked)} disabled={tagGroups.length === 0}>
              显示未标记资产
            </Checkbox>
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {derived.activeTagGroupName && (
                <Typography.Text type="secondary">当前标签组：{derived.activeTagGroupName}</Typography.Text>
              )}
              {derived.tagGroupSlices.map((slice) => (
                <div key={slice.label} className="donut-legend-item">
                  <span className="donut-legend-dot" style={{ backgroundColor: slice.color }} />
                  <Typography.Text>{slice.label}</Typography.Text>
                  <Typography.Text className="metric-value">{formatPercent(slice.value)}</Typography.Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={24} xl={8}>
          <Card title="偏离强度" className="dashboard-drift-card">
            {driftChartOption ? (
              <ReactECharts option={driftChartOption} notMerge lazyUpdate className="dashboard-echart dashboard-echart-drift" />
            ) : (
              <Typography.Text type="secondary">暂无偏离数据</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
