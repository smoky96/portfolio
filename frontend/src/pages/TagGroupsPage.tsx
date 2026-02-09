import { Alert, Button, Card, Col, Form, Input, Row, Select, Space, Table, Tooltip, message } from "antd";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { AllocationTag, AllocationTagGroup, Instrument, InstrumentTagSelection } from "../types";

interface TagGroupForm {
  name: string;
}

interface TagForm {
  name: string;
}

export default function TagGroupsPage() {
  const [tagGroups, setTagGroups] = useState<AllocationTagGroup[]>([]);
  const [tags, setTags] = useState<AllocationTag[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [instrumentTagSelections, setInstrumentTagSelections] = useState<InstrumentTagSelection[]>([]);
  const [error, setError] = useState("");
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingTagAssignments, setSavingTagAssignments] = useState(false);
  const [activeTagGroupId, setActiveTagGroupId] = useState<number | null>(null);
  const [pendingTagSelections, setPendingTagSelections] = useState<Record<string, number | null>>({});

  const [tagGroupForm] = Form.useForm<TagGroupForm>();
  const [tagForm] = Form.useForm<TagForm>();

  async function load() {
    setLoading(true);
    try {
      const [groups, allTags, allInstruments, selections] = await Promise.all([
        api.get<AllocationTagGroup[]>("/allocation/tag-groups"),
        api.get<AllocationTag[]>("/allocation/tags"),
        api.get<Instrument[]>("/instruments"),
        api.get<InstrumentTagSelection[]>("/allocation/instrument-tags")
      ]);
      setTagGroups(groups);
      setTags(allTags);
      setInstruments(allInstruments);
      setInstrumentTagSelections(selections);
      setPendingTagSelections({});
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

  useEffect(() => {
    if (tagGroups.length === 0) {
      setActiveTagGroupId(null);
      tagForm.resetFields();
      return;
    }

    const nextGroupId = activeTagGroupId && tagGroups.some((item) => item.id === activeTagGroupId) ? activeTagGroupId : tagGroups[0].id;
    if (nextGroupId !== activeTagGroupId) {
      setActiveTagGroupId(nextGroupId);
    }
  }, [tagGroups, activeTagGroupId]);

  async function createTagGroup(values: TagGroupForm) {
    try {
      await api.post("/allocation/tag-groups", {
        name: values.name,
        order_index: tagGroups.length
      });
      setMessageText("标签组已创建");
      tagGroupForm.resetFields();
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteTagGroup(groupId: number) {
    try {
      await api.delete(`/allocation/tag-groups/${groupId}`);
      setMessageText("标签组已删除");
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function createTag(values: TagForm) {
    if (!activeTagGroupId) {
      message.warning("请先创建并选择标签组");
      return;
    }

    try {
      await api.post("/allocation/tags", {
        group_id: activeTagGroupId,
        name: values.name,
        order_index: tags.filter((item) => item.group_id === activeTagGroupId).length
      });
      setMessageText("标签已创建");
      tagForm.resetFields(["name"]);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteTag(tagId: number) {
    try {
      await api.delete(`/allocation/tags/${tagId}`);
      setMessageText("标签已删除");
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  function updateInstrumentTagDraft(instrumentId: number, groupId: number, tagId?: number) {
    const key = `${instrumentId}-${groupId}`;
    const originalTagId = selectionTagIdByInstrumentGroup.get(key) ?? null;
    const nextTagId = typeof tagId === "number" ? tagId : null;

    setPendingTagSelections((prev) => {
      if (originalTagId === nextTagId) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [key]: nextTagId
      };
    });
  }

  function resetPendingTagSelections() {
    setPendingTagSelections({});
  }

  async function saveInstrumentTagSelections() {
    const changes = Object.entries(pendingTagSelections);
    if (changes.length === 0) {
      message.info("暂无待保存的标签分配改动");
      return;
    }

    setSavingTagAssignments(true);
    try {
      let appliedCount = 0;
      for (const [key, nextTagId] of changes) {
        const [instrumentIdRaw, groupIdRaw] = key.split("-");
        const instrumentId = Number(instrumentIdRaw);
        const groupId = Number(groupIdRaw);
        if (!Number.isInteger(instrumentId) || !Number.isInteger(groupId)) {
          continue;
        }

        const originalTagId = selectionTagIdByInstrumentGroup.get(key);
        if ((originalTagId ?? null) === (nextTagId ?? null)) {
          continue;
        }

        if (typeof nextTagId === "number") {
          await api.put("/allocation/instrument-tags", {
            instrument_id: instrumentId,
            group_id: groupId,
            tag_id: nextTagId
          });
          appliedCount += 1;
          continue;
        }

        if (typeof originalTagId === "number") {
          await api.delete(`/allocation/instrument-tags/${instrumentId}/${groupId}`);
          appliedCount += 1;
        }
      }

      setMessageText(`标签分配已保存（${appliedCount} 项）`);
      setPendingTagSelections({});
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingTagAssignments(false);
    }
  }

  const sortedTagGroups = useMemo(
    () => [...tagGroups].sort((a, b) => a.order_index - b.order_index || a.id - b.id),
    [tagGroups]
  );
  const tagCountByGroup = useMemo(() => {
    const map = new Map<number, number>();
    tags.forEach((item) => {
      map.set(item.group_id, (map.get(item.group_id) ?? 0) + 1);
    });
    return map;
  }, [tags]);
  const tagsByGroup = useMemo(() => {
    const map = new Map<number, AllocationTag[]>();
    tags.forEach((item) => {
      if (!map.has(item.group_id)) {
        map.set(item.group_id, []);
      }
      map.get(item.group_id)!.push(item);
    });
    for (const list of map.values()) {
      list.sort((a, b) => a.order_index - b.order_index || a.id - b.id);
    }
    return map;
  }, [tags]);
  const activeGroupTags = useMemo(
    () => (activeTagGroupId ? tagsByGroup.get(activeTagGroupId) ?? [] : []),
    [tagsByGroup, activeTagGroupId]
  );
  const selectionTagIdByInstrumentGroup = useMemo(() => {
    const map = new Map<string, number>();
    instrumentTagSelections.forEach((item) => {
      map.set(`${item.instrument_id}-${item.group_id}`, item.tag_id);
    });
    return map;
  }, [instrumentTagSelections]);
  const selectionDraftByInstrumentGroup = useMemo(() => {
    const map = new Map(selectionTagIdByInstrumentGroup);
    Object.entries(pendingTagSelections).forEach(([key, value]) => {
      if (typeof value === "number") {
        map.set(key, value);
      } else {
        map.delete(key);
      }
    });
    return map;
  }, [selectionTagIdByInstrumentGroup, pendingTagSelections]);
  const pendingSelectionCount = useMemo(() => Object.keys(pendingTagSelections).length, [pendingTagSelections]);
  const instrumentRows = useMemo(
    () => [...instruments].sort((a, b) => a.symbol.localeCompare(b.symbol, "en-US", { sensitivity: "base" }) || a.id - b.id),
    [instruments]
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {error && <Alert type="error" showIcon message="请求失败" description={error} closable />}
      {messageText && <Alert type="success" showIcon message={messageText} closable />}

      <Card className="page-section" title="标签组配置" extra={<Button onClick={() => void load()}>刷新</Button>} loading={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={8}>
            <Card size="small" title="新增标签组">
              <Form<TagGroupForm> layout="vertical" form={tagGroupForm} onFinish={(values) => void createTagGroup(values)}>
                <Form.Item label="标签组名称" name="name" rules={[{ required: true, message: "请输入标签组名称" }]}>
                  <Input placeholder="例如：行业 / 风格 / 区域" />
                </Form.Item>
                <Button type="primary" htmlType="submit">
                  创建标签组
                </Button>
              </Form>
            </Card>
          </Col>

          <Col xs={24} xl={16}>
            <Card size="small" title="标签组列表">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 420 }}
                dataSource={sortedTagGroups}
                locale={{ emptyText: "暂无标签组" }}
                columns={[
                  { title: "标签组", dataIndex: "name" },
                  {
                    title: "标签数",
                    key: "tag_count",
                    width: 100,
                    render: (_: unknown, record: AllocationTagGroup) => String(tagCountByGroup.get(record.id) ?? 0)
                  },
                  {
                    title: "操作",
                    width: 120,
                    render: (_: unknown, record: AllocationTagGroup) => (
                      <Button danger size="small" onClick={() => void deleteTagGroup(record.id)}>
                        删除
                      </Button>
                    )
                  }
                ]}
              />
            </Card>
          </Col>

          <Col xs={24}>
            <Card size="small" title="标签管理">
              <Form<TagForm> layout="vertical" form={tagForm} onFinish={(values) => void createTag(values)}>
                <Row gutter={[12, 12]} align="bottom">
                  <Col xs={24} md={8}>
                    <Form.Item label="所属标签组" required>
                      <Select
                        value={activeTagGroupId ?? undefined}
                        placeholder="选择标签组"
                        options={sortedTagGroups.map((item) => ({ value: item.id, label: item.name }))}
                        onChange={(value: number) => setActiveTagGroupId(value)}
                        disabled={sortedTagGroups.length === 0}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item label="标签名称" name="name" rules={[{ required: true, message: "请输入标签名称" }]}>
                      <Input placeholder="例如：价值 / 成长 / 高股息" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item label=" ">
                      <Button type="primary" htmlType="submit" block disabled={sortedTagGroups.length === 0 || !activeTagGroupId}>
                        创建标签
                      </Button>
                    </Form.Item>
                  </Col>
                </Row>
              </Form>

              <Table
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 420 }}
                dataSource={activeGroupTags}
                locale={{ emptyText: activeTagGroupId ? "当前标签组暂无标签" : "请先选择标签组" }}
                columns={[
                  { title: "标签", dataIndex: "name" },
                  {
                    title: "操作",
                    width: 120,
                    render: (_: unknown, record: AllocationTag) => (
                      <Button danger size="small" onClick={() => void deleteTag(record.id)}>
                        删除
                      </Button>
                    )
                  }
                ]}
              />
            </Card>
          </Col>

          <Col xs={24}>
            <Card
              size="small"
              title="标的标签分配"
              extra={
                <Space>
                  <Button onClick={resetPendingTagSelections} disabled={pendingSelectionCount === 0 || savingTagAssignments}>
                    重置改动
                  </Button>
                  <Button type="primary" onClick={() => void saveInstrumentTagSelections()} loading={savingTagAssignments} disabled={pendingSelectionCount === 0}>
                    保存分配
                  </Button>
                </Space>
              }
            >
              <Alert
                type="info"
                showIcon
                message="每个标的在每个标签组下最多选择一个标签；先编辑草稿，点击“保存分配”后统一提交。"
                style={{ marginBottom: 12 }}
              />
              <Table
                className="tag-assignment-table"
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8, showSizeChanger: false }}
                scroll={{ x: 980 }}
                dataSource={instrumentRows}
                locale={{ emptyText: "暂无标的" }}
                columns={[
                  {
                    title: "代码",
                    dataIndex: "symbol",
                    width: 140,
                    ellipsis: { showTitle: false },
                    render: (value: string) => (
                      <Tooltip title={value}>
                        <span className="ellipsis-cell">{value}</span>
                      </Tooltip>
                    )
                  },
                  {
                    title: "名称",
                    dataIndex: "name",
                    width: 240,
                    ellipsis: { showTitle: false },
                    render: (value: string) => (
                      <Tooltip title={value}>
                        <span className="ellipsis-cell">{value}</span>
                      </Tooltip>
                    )
                  },
                  ...sortedTagGroups.map((group) => ({
                    title: (
                      <Tooltip title={group.name}>
                        <span className="table-head-ellipsis">{group.name}</span>
                      </Tooltip>
                    ),
                    key: `group-${group.id}`,
                    width: Math.min(280, Math.max(180, group.name.length * 18 + 96)),
                    render: (_: unknown, record: Instrument) => {
                      const key = `${record.id}-${group.id}`;
                      const groupTags = tagsByGroup.get(group.id) ?? [];
                      const isDirty = Object.prototype.hasOwnProperty.call(pendingTagSelections, key);
                      return (
                        <Select
                          className={`instrument-tag-select instrument-tag-select-${record.id}-${group.id}`}
                          allowClear
                          placeholder={groupTags.length === 0 ? "请先创建标签" : "选择标签"}
                          value={selectionDraftByInstrumentGroup.get(key)}
                          options={groupTags.map((item) => ({ value: item.id, label: item.name }))}
                          status={isDirty ? "warning" : undefined}
                          loading={savingTagAssignments && isDirty}
                          disabled={groupTags.length === 0 || savingTagAssignments}
                          onChange={(value) => updateInstrumentTagDraft(record.id, group.id, value)}
                          style={{ width: "100%" }}
                        />
                      );
                    }
                  }))
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Card>
    </Space>
  );
}
