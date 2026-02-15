import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tree,
  Typography,
  message
} from "antd";
import type { DataNode } from "antd/es/tree";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { NODE_LEVEL_LABELS, NodeLevelLabel } from "../constants/labels";
import { Account, AllocationNode, DashboardSummary, Holding, Instrument } from "../types";
import { formatDecimal, formatPercent, isHundred, sumDecimals } from "../utils/format";

interface NodeForm {
  create_mode: "ROOT" | "SIBLING" | "CHILD";
  name: string;
  target_weight: number;
}

interface NodeRenameForm {
  name: string;
}

interface TargetSlice {
  label: string;
  weight: number;
  color: string;
}

interface LeafInstrumentRow {
  instrument_id: number;
  symbol: string;
  name: string;
  market_value: number;
  share: number;
}

interface BoundLeafHoldingInstrument {
  instrument_id: number;
  symbol: string;
  name: string;
  market: string;
  market_value: number;
}

interface BoundNodeAccount {
  account_id: number;
  name: string;
  type: string;
  base_currency: string;
  base_cash_balance: number;
}

interface SelectedNodeAccountRow {
  account_id: number;
  name: string;
  type: string;
  base_currency: string;
  base_cash_balance: number;
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

const NODE_CREATE_MODE_LABELS: Record<NodeForm["create_mode"], string> = {
  ROOT: "顶层节点",
  SIBLING: "同级节点",
  CHILD: "子节点"
};

function buildNodePath(node: AllocationNode, nodeMap: Map<number, AllocationNode>) {
  const path: string[] = [node.name];
  let parentId = node.parent_id;
  while (parentId) {
    const parent = nodeMap.get(parentId);
    if (!parent) {
      break;
    }
    path.unshift(parent.name);
    parentId = parent.parent_id;
  }
  return path.join(" / ");
}

function toNumber(value: string | number | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function buildTargetPieOption(slices: TargetSlice[]): EChartsOption | null {
  const validSlices = slices.filter((item) => Number.isFinite(item.weight) && item.weight > 0.0001);
  if (!validSlices.length) {
    return null;
  }

  return {
    animationDuration: 450,
    tooltip: {
      trigger: "item",
      formatter: (value: unknown) => {
        const item = value as { name: string; value: number };
        return `${item.name}<br/>${formatPercent(item.value)}`;
      }
    },
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
          value: Number(slice.weight.toFixed(6)),
          itemStyle: { color: slice.color }
        }))
      }
    ]
  };
}

export default function AllocationPage() {
  const [nodes, setNodes] = useState<AllocationNode[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountCashBalanceById, setAccountCashBalanceById] = useState<Record<number, number>>({});
  const [error, setError] = useState("");
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [nodeWeightDrafts, setNodeWeightDrafts] = useState<Record<number, number>>({});
  const [leafInstrumentDraftId, setLeafInstrumentDraftId] = useState<number | null>(null);
  const [nodeAccountDraftId, setNodeAccountDraftId] = useState<number | null>(null);
  const [instrumentSavingId, setInstrumentSavingId] = useState<number | null>(null);
  const [accountSavingId, setAccountSavingId] = useState<number | null>(null);

  const [nodeForm] = Form.useForm<NodeForm>();
  const [nodeRenameForm] = Form.useForm<NodeRenameForm>();

  async function load() {
    setLoading(true);
    try {
      const [nodesResp, instrumentsResp, holdingsResp, accountsResp, summaryResp] = await Promise.all([
        api.get<AllocationNode[]>("/allocation/nodes"),
        api.get<Instrument[]>("/instruments"),
        api.get<Holding[]>("/holdings"),
        api.get<Account[]>("/accounts"),
        api.get<DashboardSummary>("/dashboard/summary")
      ]);
      setNodes(nodesResp);
      setInstruments(instrumentsResp);
      setHoldings(holdingsResp);
      setAccounts(accountsResp);
      setAccountCashBalanceById(
        Object.fromEntries(
          summaryResp.account_balances.map((item) => [item.account_id, toNumber(item.base_cash_balance)])
        )
      );
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    nodeForm.setFieldsValue({ create_mode: "ROOT", target_weight: 100 });
    void load();
  }, []);

  const nodeMap = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);

  const childrenMap = useMemo(() => {
    const map = new Map<number | null, AllocationNode[]>();
    for (const node of nodes) {
      const key = node.parent_id ?? null;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(node);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base" }) || a.id - b.id);
    }
    return map;
  }, [nodes]);

  const leafNodes = useMemo(() => {
    const parentSet = new Set<number>();
    nodes.forEach((node) => {
      if (node.parent_id !== null) {
        parentSet.add(node.parent_id);
      }
    });
    return nodes.filter((node) => !parentSet.has(node.id));
  }, [nodes]);
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const selectedNodeHasChildren = selectedNode ? (childrenMap.get(selectedNode.id)?.length ?? 0) > 0 : false;
  const selectedNodeCanBindInstruments = Boolean(selectedNode && !selectedNodeHasChildren);
  const holdingsByInstrument = useMemo(() => {
    const map = new Map<
      number,
      {
        market_value: number;
      }
    >();
    holdings.forEach((row) => {
      const current = map.get(row.instrument_id);
      if (current) {
        current.market_value += toNumber(row.market_value);
      } else {
        map.set(row.instrument_id, { market_value: toNumber(row.market_value) });
      }
    });
    return map;
  }, [holdings]);

  const selectedLeafInstruments = useMemo(() => {
    if (!selectedNode || !selectedNodeCanBindInstruments) {
      return [] as Instrument[];
    }
    return instruments.filter((item) => item.allocation_node_id === selectedNode.id);
  }, [selectedNode, selectedNodeCanBindInstruments, instruments]);

  const selectedLeafInstrumentRows = useMemo(() => {
    const rows: LeafInstrumentRow[] = selectedLeafInstruments
      .map((item) => ({
        instrument_id: item.id,
        symbol: item.symbol,
        name: item.name,
        market_value: holdingsByInstrument.get(item.id)?.market_value ?? 0,
        share: 0
      }))
      .sort((a, b) => b.market_value - a.market_value || a.symbol.localeCompare(b.symbol, "zh-Hans-CN"));

    const total = rows.reduce((sum, item) => sum + item.market_value, 0);
    return rows.map((item) => ({
      ...item,
      share: total > 0 ? (item.market_value / total) * 100 : 0
    }));
  }, [selectedLeafInstruments, holdingsByInstrument]);

  const selectedLeafInstrumentIds = useMemo(() => new Set(selectedLeafInstruments.map((item) => item.id)), [selectedLeafInstruments]);
  const selectableHoldingOptions = useMemo(() => {
    return instruments
      .filter((item) => !selectedLeafInstrumentIds.has(item.id))
      .map((item) => ({
        value: item.id,
        label: `${item.symbol} · ${item.name}`,
        market_value: holdingsByInstrument.get(item.id)?.market_value ?? 0
      }))
      .sort((a, b) => b.market_value - a.market_value || a.label.localeCompare(b.label, "zh-Hans-CN"));
  }, [instruments, holdingsByInstrument, selectedLeafInstrumentIds]);

  const boundLeafHoldingInstruments = useMemo(() => {
    const map = new Map<number, BoundLeafHoldingInstrument[]>();
    instruments.forEach((item) => {
      if (item.allocation_node_id === null) {
        return;
      }
      if (!map.has(item.allocation_node_id)) {
        map.set(item.allocation_node_id, []);
      }
      map.get(item.allocation_node_id)!.push({
        instrument_id: item.id,
        symbol: item.symbol,
        name: item.name,
        market: item.market,
        market_value: holdingsByInstrument.get(item.id)?.market_value ?? 0
      });
    });

    for (const list of map.values()) {
      list.sort((a, b) => b.market_value - a.market_value || a.symbol.localeCompare(b.symbol, "en-US", { sensitivity: "base" }));
    }
    return map;
  }, [instruments, holdingsByInstrument]);

  const boundNodeAccounts = useMemo(() => {
    const map = new Map<number, BoundNodeAccount[]>();
    accounts.forEach((item) => {
      if (item.allocation_node_id === null) {
        return;
      }
      if (!map.has(item.allocation_node_id)) {
        map.set(item.allocation_node_id, []);
      }
      map.get(item.allocation_node_id)!.push({
        account_id: item.id,
        name: item.name,
        type: item.type,
        base_currency: item.base_currency,
        base_cash_balance: accountCashBalanceById[item.id] ?? 0
      });
    });
    for (const list of map.values()) {
      list.sort((a, b) => b.base_cash_balance - a.base_cash_balance || a.name.localeCompare(b.name, "zh-Hans-CN"));
    }
    return map;
  }, [accounts, accountCashBalanceById]);

  const selectedNodeAccountRows = useMemo(() => {
    if (!selectedNode) {
      return [] as SelectedNodeAccountRow[];
    }
    return accounts
      .filter((item) => item.allocation_node_id === selectedNode.id)
      .map((item) => ({
        account_id: item.id,
        name: item.name,
        type: item.type,
        base_currency: item.base_currency,
        base_cash_balance: accountCashBalanceById[item.id] ?? 0
      }))
      .sort((a, b) => b.base_cash_balance - a.base_cash_balance || a.name.localeCompare(b.name, "zh-Hans-CN"));
  }, [selectedNode, accounts, accountCashBalanceById]);

  const selectableAccountOptions = useMemo(() => {
    if (!selectedNode) {
      return [] as Array<{ value: number; label: string; base_cash_balance: number }>;
    }
    return accounts
      .filter((item) => item.allocation_node_id !== selectedNode.id)
      .map((item) => ({
        value: item.id,
        label: `${item.name} · ${item.type}`,
        base_cash_balance: accountCashBalanceById[item.id] ?? 0
      }))
      .sort((a, b) => b.base_cash_balance - a.base_cash_balance || a.label.localeCompare(b.label, "zh-Hans-CN"));
  }, [selectedNode, accounts, accountCashBalanceById]);

  function resolveCreateParentId(mode: NodeForm["create_mode"], currentNode: AllocationNode | null): number | null {
    if (mode === "ROOT") {
      return null;
    }
    if (!currentNode) {
      return null;
    }
    if (mode === "SIBLING") {
      return currentNode.parent_id;
    }
    return currentNode.id;
  }

  useEffect(() => {
    if (selectedNode) {
      nodeRenameForm.setFieldsValue({ name: selectedNode.name });
    } else {
      nodeRenameForm.resetFields();
    }
  }, [selectedNodeId, nodes]);

  useEffect(() => {
    setLeafInstrumentDraftId(null);
    setNodeAccountDraftId(null);
  }, [selectedNodeId]);

  useEffect(() => {
    if (leafInstrumentDraftId === null) {
      return;
    }
    if (!selectableHoldingOptions.some((item) => item.value === leafInstrumentDraftId)) {
      setLeafInstrumentDraftId(null);
    }
  }, [leafInstrumentDraftId, selectableHoldingOptions]);

  useEffect(() => {
    if (nodeAccountDraftId === null) {
      return;
    }
    if (!selectableAccountOptions.some((item) => item.value === nodeAccountDraftId)) {
      setNodeAccountDraftId(null);
    }
  }, [nodeAccountDraftId, selectableAccountOptions]);

  function getNodeLevel(node: AllocationNode): NodeLevelLabel {
    if (node.parent_id === null) {
      return "ROOT";
    }
    return childrenMap.get(node.id)?.length ? "BRANCH" : "LEAF";
  }

  function getSiblingNodes(parentId: number | null) {
    return nodes
      .filter((item) => item.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base" }) || a.id - b.id);
  }

  const activeParentId = selectedNode ? selectedNode.parent_id : null;
  const activeSiblingNodes = useMemo(() => getSiblingNodes(activeParentId), [nodes, activeParentId]);
  const activeSiblingTotal = useMemo(
    () => sumDecimals(activeSiblingNodes.map((item) => nodeWeightDrafts[item.id] ?? Number(item.target_weight))),
    [activeSiblingNodes, nodeWeightDrafts]
  );
  const activeParentLabel = activeParentId === null ? "顶层（ROOT）" : nodeMap.get(activeParentId)?.name ?? `节点 ${activeParentId}`;

  async function saveNodeSiblingWeights(parentId: number | null) {
    const siblings = getSiblingNodes(parentId);
    if (siblings.length === 0) {
      return;
    }

    const payloadItems = siblings.map((item) => ({
      id: item.id,
      target_weight: nodeWeightDrafts[item.id] ?? Number(item.target_weight)
    }));
    const total = sumDecimals(payloadItems.map((item) => item.target_weight));
    if (!isHundred(total)) {
      message.error(`同层节点权重之和必须为 100%，当前为 ${total.toFixed(3)}%`);
      return;
    }

    try {
      await api.patch("/allocation/nodes/weights/batch", {
        parent_id: parentId,
        items: payloadItems
      });
      setMessageText("同层节点权重已更新");
      setNodeWeightDrafts((prev) => {
        const next = { ...prev };
        siblings.forEach((item) => delete next[item.id]);
        return next;
      });
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function renameSelectedNode(values: NodeRenameForm) {
    if (!selectedNode) {
      return;
    }

    try {
      await api.patch(`/allocation/nodes/${selectedNode.id}`, {
        name: values.name
      });
      setMessageText("节点名称已更新");
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function createNode(values: NodeForm) {
    const mode = values.create_mode ?? "ROOT";
    const parentId = resolveCreateParentId(mode, selectedNode);
    try {
      await api.post("/allocation/nodes", {
        parent_id: parentId,
        name: values.name,
        target_weight: values.target_weight
      });
      setMessageText("层级节点已创建");
      nodeForm.resetFields(["name"]);
      nodeForm.setFieldValue("create_mode", mode);
      const siblings = getSiblingNodes(parentId);
      nodeForm.setFieldValue("target_weight", siblings.length === 0 ? 100 : 0);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteSelectedNode() {
    if (!selectedNode) {
      return;
    }

    try {
      await api.delete(`/allocation/nodes/${selectedNode.id}`);
      setSelectedNodeId(null);
      setMessageText("层级节点已删除");
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  function confirmDeleteSelectedNode() {
    if (!selectedNode) {
      return;
    }
    Modal.confirm({
      title: `确认删除节点「${selectedNode.name}」？`,
      content: "删除后会同时删除其全部子节点与标的配置，且无法恢复。",
      okText: "确认删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => deleteSelectedNode()
    });
  }

  async function bindInstrumentToNode() {
    if (!selectedNode || !selectedNodeCanBindInstruments || leafInstrumentDraftId === null) {
      message.warning("请先选择一个无子节点的层级并指定标的");
      return;
    }

    setInstrumentSavingId(leafInstrumentDraftId);
    try {
      await api.patch(`/instruments/${leafInstrumentDraftId}`, {
        allocation_node_id: selectedNode.id
      });
      setLeafInstrumentDraftId(null);
      setMessageText("持仓标的已添加到当前节点");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setInstrumentSavingId(null);
    }
  }

  async function removeInstrumentFromLeaf(instrumentId: number) {
    setInstrumentSavingId(instrumentId);
    try {
      await api.patch(`/instruments/${instrumentId}`, {
        allocation_node_id: null
      });
      setMessageText("标的已从当前节点移除");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setInstrumentSavingId(null);
    }
  }

  async function bindAccountToNode() {
    if (!selectedNode || nodeAccountDraftId === null) {
      message.warning("请先选择层级并指定账户");
      return;
    }

    setAccountSavingId(nodeAccountDraftId);
    try {
      await api.patch(`/accounts/${nodeAccountDraftId}`, {
        allocation_node_id: selectedNode.id
      });
      setNodeAccountDraftId(null);
      setMessageText("账户现金归属已更新");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setAccountSavingId(null);
    }
  }

  async function removeAccountFromNode(accountId: number) {
    setAccountSavingId(accountId);
    try {
      await api.patch(`/accounts/${accountId}`, {
        allocation_node_id: null
      });
      setMessageText("账户已从当前层级移除");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setAccountSavingId(null);
    }
  }

  useEffect(() => {
    const nextMode: NodeForm["create_mode"] = selectedNode ? "CHILD" : "ROOT";
    const parentId = resolveCreateParentId(nextMode, selectedNode);
    const siblings = getSiblingNodes(parentId);
    nodeForm.setFieldsValue({
      create_mode: nextMode,
      target_weight: siblings.length === 0 ? 100 : 0
    });
  }, [selectedNodeId, nodes]);

  const treeData: DataNode[] = useMemo(() => {
    function build(parentId: number | null): DataNode[] {
      const siblings = childrenMap.get(parentId) ?? [];
      return siblings.map((node) => {
        const hasNodeChildren = (childrenMap.get(node.id)?.length ?? 0) > 0;
        const title = (
          <div className="tree-node-title">
            <div className="tree-node-left">
              <Typography.Text>{node.name}</Typography.Text>
            </div>
            <Typography.Text type="secondary">{formatPercent(nodeWeightDrafts[node.id] ?? Number(node.target_weight))}</Typography.Text>
          </div>
        );

        const nodeChildren = build(node.id);
        const holdingChildren =
          !hasNodeChildren
            ? (boundLeafHoldingInstruments.get(node.id) ?? []).map((instrument) => ({
                key: `inst-${instrument.instrument_id}`,
                selectable: false,
                isLeaf: true,
                title: (
                  <div className="tree-instrument-title">
                    <div className="tree-instrument-main">
                      <Typography.Text type="secondary" className="tree-instrument-symbol">
                        {instrument.symbol}
                      </Typography.Text>
                      <Typography.Text type="secondary" className="tree-instrument-name">
                        {instrument.name}
                      </Typography.Text>
                      <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                        标的
                      </Tag>
                    </div>
                    <Typography.Text type="secondary" className="tree-instrument-value">
                      {formatDecimal(instrument.market_value)}
                    </Typography.Text>
                  </div>
                )
              }))
            : [];

        const accountChildren = (boundNodeAccounts.get(node.id) ?? []).map((account) => ({
          key: `acc-${account.account_id}`,
          selectable: false,
          isLeaf: true,
          title: (
            <div className="tree-instrument-title">
              <div className="tree-instrument-main">
                <Typography.Text type="secondary" className="tree-instrument-symbol">
                  {account.name}
                </Typography.Text>
                <Typography.Text type="secondary" className="tree-instrument-name">
                  {account.type}
                </Typography.Text>
                <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                  账户现金
                </Tag>
              </div>
              <Typography.Text type="secondary" className="tree-instrument-value">
                {formatDecimal(account.base_cash_balance)}
              </Typography.Text>
            </div>
          )
        }));

        return {
          key: String(node.id),
          title,
          children: [...nodeChildren, ...holdingChildren, ...accountChildren]
        };
      });
    }

    return build(null);
  }, [childrenMap, nodeWeightDrafts, boundLeafHoldingInstruments, boundNodeAccounts]);

  const nodeGlobalWeightMap = useMemo(() => {
    const map = new Map<number, number>();

    const calc = (node: AllocationNode): number => {
      if (map.has(node.id)) {
        return map.get(node.id)!;
      }

      const currentWeight = Number(node.target_weight);
      if (node.parent_id === null) {
        map.set(node.id, currentWeight);
        return currentWeight;
      }

      const parent = nodeMap.get(node.parent_id);
      if (!parent) {
        map.set(node.id, 0);
        return 0;
      }

      const globalWeight = (calc(parent) * currentWeight) / 100;
      map.set(node.id, globalWeight);
      return globalWeight;
    };

    nodes.forEach((node) => {
      calc(node);
    });

    return map;
  }, [nodes, nodeMap]);

  const targetRootSlices = useMemo(() => {
    const roots = nodes
      .filter((item) => item.parent_id === null)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base" }) || a.id - b.id);

    const slices: TargetSlice[] = roots
      .map((item, index) => ({
        label: item.name,
        weight: Number(item.target_weight),
        color: CHART_COLORS[index % CHART_COLORS.length]
      }))
      .filter((item) => item.weight > 0);

    const sumWeight = slices.reduce((sum, item) => sum + item.weight, 0);
    if (sumWeight < 100 - 0.0001) {
      slices.push({
        label: "未分配",
        weight: Number((100 - sumWeight).toFixed(4)),
        color: "#d9d9d9"
      });
    }

    return slices;
  }, [nodes]);

  const targetLeafSlices = useMemo(() => {
    const slices = leafNodes
      .map((item, index) => ({
        label: item.name,
        weight: nodeGlobalWeightMap.get(item.id) ?? 0,
        color: CHART_COLORS[index % CHART_COLORS.length]
      }))
      .filter((item) => item.weight > 0.0001)
      .sort((a, b) => b.weight - a.weight);

    const sumWeight = slices.reduce((sum, item) => sum + item.weight, 0);
    if (sumWeight < 100 - 0.0001) {
      slices.push({
        label: "未分配",
        weight: Number((100 - sumWeight).toFixed(4)),
        color: "#d9d9d9"
      });
    }

    return slices;
  }, [leafNodes, nodeGlobalWeightMap]);

  const selectedNodeSlices = useMemo(() => {
    if (!selectedNode) {
      return [] as TargetSlice[];
    }

    if (selectedNodeCanBindInstruments) {
      const rows = selectedLeafInstrumentRows.filter((item) => item.market_value > 0.0001);
      const accountRows = selectedNodeAccountRows.filter((item) => item.base_cash_balance > 0.0001);
      const totalMarketValue = rows.reduce((sum, item) => sum + item.market_value, 0);
      const totalCashValue = accountRows.reduce((sum, item) => sum + item.base_cash_balance, 0);
      const totalValue = totalMarketValue + totalCashValue;
      if (totalValue <= 0) {
        return [] as TargetSlice[];
      }
      const instrumentSlices = rows.map((item, index) => ({
        label: item.symbol,
        weight: (item.market_value / totalValue) * 100,
        color: CHART_COLORS[index % CHART_COLORS.length]
      }));
      const accountSlices = accountRows.map((item, index) => ({
        label: `${item.name}·现金`,
        weight: (item.base_cash_balance / totalValue) * 100,
        color: CHART_COLORS[(rows.length + index) % CHART_COLORS.length]
      }));
      return [...instrumentSlices, ...accountSlices];
    }

    const children = childrenMap.get(selectedNode.id) ?? [];
    const slices = children
      .map((item, index) => ({
        label: item.name,
        weight: Number(item.target_weight),
        color: CHART_COLORS[index % CHART_COLORS.length]
      }))
      .filter((item) => item.weight > 0);

    const sumWeight = slices.reduce((sum, item) => sum + item.weight, 0);
    if (sumWeight < 100 - 0.0001) {
      slices.push({
        label: "未分配",
        weight: Number((100 - sumWeight).toFixed(4)),
        color: "#d9d9d9"
      });
    }

    return slices;
  }, [selectedNode, selectedNodeCanBindInstruments, childrenMap, selectedLeafInstrumentRows, selectedNodeAccountRows]);

  const rootChartOption = useMemo(() => buildTargetPieOption(targetRootSlices), [targetRootSlices]);
  const leafChartOption = useMemo(() => buildTargetPieOption(targetLeafSlices), [targetLeafSlices]);
  const selectedNodeChartOption = useMemo(() => buildTargetPieOption(selectedNodeSlices), [selectedNodeSlices]);

  const rootWeight = sumDecimals(nodes.filter((item) => item.parent_id === null).map((item) => item.target_weight));
  const createModeOptions = useMemo(() => {
    const options: Array<{ label: string; value: NodeForm["create_mode"] }> = [
      { label: NODE_CREATE_MODE_LABELS.ROOT, value: "ROOT" }
    ];
    if (selectedNode) {
      options.push(
        { label: NODE_CREATE_MODE_LABELS.SIBLING, value: "SIBLING" },
        { label: NODE_CREATE_MODE_LABELS.CHILD, value: "CHILD" }
      );
    }
    return options;
  }, [selectedNode]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }} className="page-stack allocation-page">
      {error && <Alert type="error" showIcon message="请求失败" description={error} closable />}
      {messageText && <Alert type="success" showIcon message={messageText} closable />}

      <Row gutter={[16, 16]} className="page-section dashboard-chart-row allocation-chart-row">
        <Col xs={24} md={12} xl={8}>
          <Card title="目标资产结构（根节点）" className="dashboard-pie-card">
            {rootChartOption ? (
              <ReactECharts option={rootChartOption} notMerge lazyUpdate className="dashboard-echart dashboard-echart-pie" />
            ) : (
              <div className="chart-empty">暂无可展示数据</div>
            )}
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {targetRootSlices.map((slice) => (
                <div key={slice.label} className="donut-legend-item">
                  <span className="donut-legend-dot" style={{ backgroundColor: slice.color }} />
                  <Typography.Text>{slice.label}</Typography.Text>
                  <Typography.Text className="metric-value">{formatPercent(slice.weight)}</Typography.Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card title="目标资产结构（叶子节点）" className="dashboard-pie-card">
            {leafChartOption ? (
              <ReactECharts option={leafChartOption} notMerge lazyUpdate className="dashboard-echart dashboard-echart-pie" />
            ) : (
              <div className="chart-empty">暂无可展示数据</div>
            )}
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {targetLeafSlices.map((slice) => (
                <div key={slice.label} className="donut-legend-item">
                  <span className="donut-legend-dot" style={{ backgroundColor: slice.color }} />
                  <Typography.Text>{slice.label}</Typography.Text>
                  <Typography.Text className="metric-value">{formatPercent(slice.weight)}</Typography.Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card title="当前层级资产结构" className="dashboard-pie-card">
            {!selectedNode ? (
              <div className="chart-empty">请先在下方树中选择节点</div>
            ) : selectedNodeChartOption ? (
              <ReactECharts option={selectedNodeChartOption} notMerge lazyUpdate className="dashboard-echart dashboard-echart-pie" />
            ) : (
              <div className="chart-empty">{selectedNodeCanBindInstruments ? "当前节点暂无持仓标的" : "暂无可展示数据"}</div>
            )}
            {selectedNode && selectedNodeSlices.length > 0 && (
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                {selectedNodeSlices.map((slice) => (
                  <div key={slice.label} className="donut-legend-item">
                    <span className="donut-legend-dot" style={{ backgroundColor: slice.color }} />
                    <Typography.Text>{slice.label}</Typography.Text>
                    <Typography.Text className="metric-value">{formatPercent(slice.weight)}</Typography.Text>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Card title="资产层级配置" extra={<Button onClick={() => void load()}>刷新</Button>} className="allocation-main-card page-section allocation-workbench-card" loading={loading}>
        <Alert
          type={isHundred(rootWeight) ? "success" : "warning"}
          message={isHundred(rootWeight) ? "顶层权重合计为 100%" : `顶层权重合计为 ${rootWeight.toFixed(3)}%，请校准`}
          showIcon
        />

        <div className="allocation-workbench">
          <div className="allocation-panel">
            <div className="allocation-panel-head">
              <Typography.Title level={5} style={{ margin: 0 }}>
                资产层级
              </Typography.Title>
            </div>
            <div className="allocation-tree-wrap">
              <Tree
                blockNode
                showLine
                selectedKeys={selectedNodeId ? [String(selectedNodeId)] : []}
                onSelect={(keys) => {
                  if (keys.length === 0) {
                    setSelectedNodeId(null);
                    return;
                  }
                  const key = String(keys[0]);
                  const parsed = Number(key);
                  if (Number.isFinite(parsed)) {
                    setSelectedNodeId(parsed);
                  }
                }}
                treeData={treeData}
                defaultExpandAll
              />
            </div>
          </div>

          <div className="allocation-panel allocation-editor-panel">
            <div className="allocation-panel-head">
              <Typography.Title level={5} style={{ margin: 0 }}>
                节点编辑
              </Typography.Title>
              {selectedNode ? (
                <Tag color={getNodeLevel(selectedNode) === "ROOT" ? "gold" : selectedNodeCanBindInstruments ? "green" : "blue"}>
                  {NODE_LEVEL_LABELS[getNodeLevel(selectedNode)]}
                </Tag>
              ) : null}
            </div>

            {!selectedNode && <Alert type="info" showIcon message="请先在左侧树中选择一个节点，再进行编辑。" />}

            {selectedNode && (
              <div className="allocation-editor-stack">
                <div className="allocation-editor-group allocation-editor-overview">
                  <Typography.Text className="allocation-node-path">
                    当前节点：<Tag color="blue">{buildNodePath(selectedNode, nodeMap)}</Tag>
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    在这里可以修改节点名称、删除节点、校准同层权重，以及为无子节点的层级挂载标的。
                  </Typography.Text>
                </div>

                <div className="allocation-editor-group">
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    节点基础信息
                  </Typography.Title>
                  <Form<NodeRenameForm> layout="vertical" form={nodeRenameForm} onFinish={(values) => void renameSelectedNode(values)} className="allocation-rename-form">
                    <div className="allocation-rename-grid">
                      <Form.Item
                        className="allocation-rename-field"
                        label="节点名称"
                        name="name"
                        rules={[{ required: true, message: "请输入节点名称" }]}
                      >
                        <Input placeholder="输入新节点名称" />
                      </Form.Item>
                      <div className="allocation-rename-actions">
                        <Button type="primary" htmlType="submit">
                          保存名称
                        </Button>
                        <Button danger onClick={confirmDeleteSelectedNode}>
                          删除当前节点
                        </Button>
                      </div>
                    </div>
                  </Form>
                </div>

                {selectedNodeCanBindInstruments && (
                  <div className="allocation-editor-group">
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      持仓标的配置
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      当前节点无子节点，可将已有标的（含自定义标的）归入该节点，用于“当前层级资产结构”展示标的占比。
                    </Typography.Text>
                    <Space.Compact className="allocation-instrument-bind" style={{ width: "100%" }}>
                      <Select
                        value={leafInstrumentDraftId}
                        placeholder="选择标的"
                        style={{ flex: 1 }}
                        showSearch
                        allowClear
                        optionFilterProp="label"
                        options={selectableHoldingOptions}
                        onChange={(value) => setLeafInstrumentDraftId(value ?? null)}
                      />
                      <Button
                        type="primary"
                        onClick={() => void bindInstrumentToNode()}
                        loading={instrumentSavingId !== null}
                        disabled={leafInstrumentDraftId === null}
                      >
                        添加标的
                      </Button>
                    </Space.Compact>
                    <Table<LeafInstrumentRow>
                      rowKey="instrument_id"
                      pagination={false}
                      size="small"
                      scroll={{ x: 580 }}
                      dataSource={selectedLeafInstrumentRows}
                      locale={{ emptyText: "当前节点暂无标的" }}
                      columns={[
                        { title: "标的代码", dataIndex: "symbol" },
                        { title: "标的名称", dataIndex: "name", ellipsis: true },
                        {
                          title: "当前市值",
                          dataIndex: "market_value",
                          align: "right",
                          render: (value: number) => formatDecimal(value)
                        },
                        {
                          title: "占比",
                          dataIndex: "share",
                          align: "right",
                          render: (value: number) => formatPercent(value)
                        },
                        {
                          title: "操作",
                          key: "actions",
                          width: 90,
                          render: (_: unknown, record: LeafInstrumentRow) => (
                            <Button
                              type="link"
                              danger
                              onClick={() => void removeInstrumentFromLeaf(record.instrument_id)}
                              loading={instrumentSavingId === record.instrument_id}
                            >
                              移除
                            </Button>
                          )
                        }
                      ]}
                    />
                  </div>
                )}

                <div className="allocation-editor-group">
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    账户现金归属配置
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    可将账户现金归入当前层级，用于仪表盘“资产结构”按你配置的层级展示现金归属。
                  </Typography.Text>
                  <Space.Compact className="allocation-instrument-bind" style={{ width: "100%" }}>
                    <Select
                      value={nodeAccountDraftId}
                      placeholder="选择账户"
                      style={{ flex: 1 }}
                      showSearch
                      allowClear
                      optionFilterProp="label"
                      options={selectableAccountOptions}
                      onChange={(value) => setNodeAccountDraftId(value ?? null)}
                    />
                    <Button type="primary" onClick={() => void bindAccountToNode()} loading={accountSavingId !== null} disabled={nodeAccountDraftId === null}>
                      添加账户
                    </Button>
                  </Space.Compact>
                  <Table<SelectedNodeAccountRow>
                    rowKey="account_id"
                    pagination={false}
                    size="small"
                    scroll={{ x: 580 }}
                    dataSource={selectedNodeAccountRows}
                    locale={{ emptyText: "当前节点暂无账户" }}
                    columns={[
                      { title: "账户名称", dataIndex: "name" },
                      { title: "账户类型", dataIndex: "type", width: 110 },
                      { title: "币种", dataIndex: "base_currency", width: 90 },
                      {
                        title: "当前现金",
                        dataIndex: "base_cash_balance",
                        align: "right",
                        render: (value: number) => formatDecimal(value)
                      },
                      {
                        title: "操作",
                        key: "actions",
                        width: 90,
                        render: (_: unknown, record: SelectedNodeAccountRow) => (
                          <Button
                            type="link"
                            danger
                            onClick={() => void removeAccountFromNode(record.account_id)}
                            loading={accountSavingId === record.account_id}
                          >
                            移除
                          </Button>
                        )
                      }
                    ]}
                  />
                </div>

                <div className="allocation-editor-group">
                  <div className="allocation-editor-title-row">
                    <Typography.Text strong>
                      同层权重校准：<Tag color="blue">{activeParentLabel}</Tag>
                    </Typography.Text>
                    <Tag color={isHundred(activeSiblingTotal) ? "success" : "warning"}>{formatPercent(activeSiblingTotal)}</Tag>
                  </div>
                  <Typography.Text type="secondary">
                    保存时会一次性更新当前父节点下所有子节点权重，建议先把目标比例全部调整完再统一提交。
                  </Typography.Text>
                  <Table
                    rowKey="id"
                    pagination={false}
                    size="small"
                    scroll={{ x: 520 }}
                    dataSource={activeSiblingNodes}
                    locale={{ emptyText: "当前层暂无节点" }}
                    columns={[
                      { title: "节点名称", dataIndex: "name" },
                      {
                        title: "层级标签",
                        key: "level",
                        render: (_: unknown, record: AllocationNode) => {
                          const level = getNodeLevel(record);
                          const color = level === "ROOT" ? "gold" : level === "BRANCH" ? "blue" : "green";
                          return <Tag color={color}>{NODE_LEVEL_LABELS[level]}</Tag>;
                        }
                      },
                      {
                        title: "目标权重",
                        key: "target_weight",
                        render: (_: unknown, record: AllocationNode) => (
                          <Space>
                            <InputNumber
                              className="inline-weight"
                              min={0}
                              max={100}
                              precision={3}
                              value={nodeWeightDrafts[record.id] ?? Number(record.target_weight)}
                              onChange={(value) =>
                                setNodeWeightDrafts((prev) => ({
                                  ...prev,
                                  [record.id]: value === null ? Number(record.target_weight) : value
                                }))
                              }
                            />
                            <Typography.Text type="secondary">%</Typography.Text>
                          </Space>
                        )
                      }
                    ]}
                  />
                  <Button type="primary" onClick={() => void saveNodeSiblingWeights(activeParentId)} disabled={activeSiblingNodes.length === 0}>
                    保存当前父节点下的全部子节点权重
                  </Button>
                </div>
              </div>
            )}

            <div className="allocation-editor-group allocation-editor-group-create">
              <Typography.Title level={5} style={{ margin: 0 }}>
                新增节点
              </Typography.Title>
              <Typography.Text type="secondary">
                选择插入位置后，系统会自动根据同层节点数量给出默认权重（首个节点默认 100%）。
              </Typography.Text>
              <Form<NodeForm>
                layout="vertical"
                form={nodeForm}
                onFinish={(values) => void createNode(values)}
                onValuesChange={(changedValues, allValues) => {
                  if (!Object.prototype.hasOwnProperty.call(changedValues, "create_mode")) {
                    return;
                  }
                  const mode = (allValues.create_mode as NodeForm["create_mode"]) ?? "ROOT";
                  const parentId = resolveCreateParentId(mode, selectedNode);
                  const siblings = getSiblingNodes(parentId);
                  nodeForm.setFieldValue("target_weight", siblings.length === 0 ? 100 : 0);
                }}
              >
                <Form.Item label="插入位置" name="create_mode" rules={[{ required: true, message: "请选择插入位置" }]}>
                  <Radio.Group className="allocation-create-mode" options={createModeOptions} optionType="button" />
                </Form.Item>
                <Form.Item label="节点名称" name="name" rules={[{ required: true, message: "请输入节点名称" }]}>
                  <Input placeholder="例如：权益类" />
                </Form.Item>
                <Form.Item label="目标权重（%）" name="target_weight" rules={[{ required: true, message: "请输入目标权重" }]}>
                  <InputNumber min={0} max={100} precision={3} style={{ width: "100%" }} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}>
                  创建节点
                </Button>
              </Form>
            </div>
          </div>
        </div>
      </Card>
    </Space>
  );
}
