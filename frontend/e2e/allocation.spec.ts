import { expect, test, type Locator } from "@playwright/test";

function formItem(container: Locator, label: string): Locator {
  return container.locator(`.ant-form-item:has(label:has-text("${label}"))`).first();
}

async function safeClick(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ force: true });
}

interface AllocationNodeFixture {
  id: number;
  parent_id: number | null;
  name: string;
}

interface InstrumentFixture {
  id: number;
  symbol: string;
  name: string;
  allocation_node_id: number | null;
}

interface HoldingFixture {
  instrument_id: number;
}

interface InstrumentTagSelectionFixture {
  instrument_id: number;
  group_id: number;
  tag_id: number;
}

test.describe("Allocation tag management @allocation", () => {
  test("single group selector and create-tag flow works", async ({ page, request }, testInfo) => {
    const unique = `${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${Date.now().toString().slice(-6)}`;
    const groupName = `测试标签组${unique}`;
    const tagName = `测试标签${unique}`;
    let groupId: number | null = null;
    try {
      const createGroupResp = await request.post("/api/v1/allocation/tag-groups", {
        data: {
          name: groupName,
          order_index: 9999
        }
      });
      expect(createGroupResp.ok()).toBeTruthy();
      groupId = (await createGroupResp.json()).id as number;

      await page.goto("/tags");
      await expect(page.getByText("标签组配置")).toBeVisible();

      const tagManageCard = page
        .locator(".ant-card-head-title", { hasText: "标签管理" })
        .first()
        .locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-card ')][1]");

      await expect(tagManageCard).toBeVisible();

      const groupSelect = tagManageCard.locator(".ant-select").first();
      await expect(groupSelect).toHaveCount(1);
      await expect(groupSelect.locator(".ant-select-selection-item").first()).toBeVisible();

      await formItem(tagManageCard, "标签名称").locator("input").first().fill(tagName);
      await safeClick(tagManageCard.getByRole("button", { name: "创建标签", exact: true }));
      const tagRows = tagManageCard.locator(".ant-table-tbody tr");
      await expect(tagRows.filter({ hasText: tagName }).first()).toBeVisible();
    } finally {
      if (groupId !== null) {
        await request.delete(`/api/v1/allocation/tag-groups/${groupId}`);
      }
    }
  });

  test("instrument tag assignment is submitted only after save", async ({ page, request }, testInfo) => {
    const unique = `${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${Date.now().toString().slice(-6)}`;
    const groupName = `保存模式标签组${unique}`;
    const tagName = `保存模式标签${unique}`;

    let groupId: number | null = null;
    try {
      const createGroupResp = await request.post("/api/v1/allocation/tag-groups", {
        data: {
          name: groupName,
          order_index: -9999
        }
      });
      expect(createGroupResp.ok()).toBeTruthy();
      groupId = (await createGroupResp.json()).id as number;

      const createTagResp = await request.post("/api/v1/allocation/tags", {
        data: {
          group_id: groupId,
          name: tagName,
          order_index: 0
        }
      });
      expect(createTagResp.ok()).toBeTruthy();
      const createdTagId = (await createTagResp.json()).id as number;

      const instrumentsResp = await request.get("/api/v1/instruments");
      expect(instrumentsResp.ok()).toBeTruthy();
      const instruments = (await instrumentsResp.json()) as InstrumentFixture[];
      expect(instruments.length).toBeGreaterThan(0);
      const targetInstrument = [...instruments].sort((a, b) => a.symbol.localeCompare(b.symbol, "en-US", { sensitivity: "base" }) || a.id - b.id)[0];

      await page.goto("/tags");
      await expect(page.getByText("标签组配置")).toBeVisible();

      const allocationCard = page.locator(".ant-card").filter({ hasText: "标的标签分配" }).first();
      await expect(allocationCard).toBeVisible();

      const saveButton = allocationCard.getByRole("button", { name: "保存分配", exact: true });
      await expect(saveButton).toBeDisabled();

      const row = allocationCard.locator(".ant-table-tbody tr").filter({ hasText: targetInstrument.symbol }).first();
      await expect(row).toBeVisible();

      const tagSelect = allocationCard.locator(`.instrument-tag-select-${targetInstrument.id}-${groupId}`).first();
      await expect(tagSelect).toBeVisible();
      await safeClick(tagSelect.locator(".ant-select-selector"));
      const dropdown = page.locator(".ant-select-dropdown:visible").last();
      await safeClick(dropdown.locator(".ant-select-item-option").filter({ hasText: tagName }).first());

      const beforeSaveResp = await request.get("/api/v1/allocation/instrument-tags");
      expect(beforeSaveResp.ok()).toBeTruthy();
      const beforeSaveSelections = (await beforeSaveResp.json()) as InstrumentTagSelectionFixture[];
      expect(beforeSaveSelections.some((item) => item.instrument_id === targetInstrument.id && item.group_id === groupId)).toBeFalsy();

      await expect(saveButton).toBeEnabled();
      await safeClick(saveButton);
      await expect(page.getByText("标签分配已保存")).toBeVisible();

      const afterSaveResp = await request.get("/api/v1/allocation/instrument-tags");
      expect(afterSaveResp.ok()).toBeTruthy();
      const afterSaveSelections = (await afterSaveResp.json()) as InstrumentTagSelectionFixture[];
      const selection = afterSaveSelections.find((item) => item.instrument_id === targetInstrument.id && item.group_id === groupId);
      expect(selection).toBeTruthy();
      expect(selection?.tag_id).toBe(createdTagId);
    } finally {
      if (groupId !== null) {
        await request.delete(`/api/v1/allocation/tag-groups/${groupId}`);
      }
    }
  });

  test("node without children can bind holding instrument and show share in current-level pie", async ({ page, request }) => {
    const [nodesResp, instrumentsResp, holdingsResp] = await Promise.all([
      request.get("/api/v1/allocation/nodes"),
      request.get("/api/v1/instruments"),
      request.get("/api/v1/holdings")
    ]);
    expect(nodesResp.ok()).toBeTruthy();
    expect(instrumentsResp.ok()).toBeTruthy();
    expect(holdingsResp.ok()).toBeTruthy();

    const nodes = (await nodesResp.json()) as AllocationNodeFixture[];
    const instruments = (await instrumentsResp.json()) as InstrumentFixture[];
    const holdings = (await holdingsResp.json()) as HoldingFixture[];

    expect(nodes.length).toBeGreaterThan(0);
    expect(holdings.length).toBeGreaterThan(0);

    const parentNodeIds = new Set(nodes.filter((item) => item.parent_id !== null).map((item) => item.parent_id as number));
    const leafNodes = nodes.filter((item) => !parentNodeIds.has(item.id));
    expect(leafNodes.length).toBeGreaterThan(0);

    const uniqueHoldingInstrumentIds = Array.from(new Set(holdings.map((item) => item.instrument_id)));
    const instrumentMap = new Map(instruments.map((item) => [item.id, item]));

    let targetLeaf: AllocationNodeFixture | null = null;
    let targetInstrument: InstrumentFixture | null = null;
    for (const leaf of leafNodes) {
      const candidate = uniqueHoldingInstrumentIds
        .map((instrumentId) => instrumentMap.get(instrumentId) ?? null)
        .find((instrument) => instrument && instrument.allocation_node_id !== leaf.id);
      if (candidate) {
        targetLeaf = leaf;
        targetInstrument = candidate;
        break;
      }
    }

    expect(targetLeaf).toBeTruthy();
    expect(targetInstrument).toBeTruthy();
    if (!targetLeaf || !targetInstrument) {
      return;
    }

    const originalAllocationNodeId = targetInstrument.allocation_node_id;
    try {
      const bindResp = await request.patch(`/api/v1/instruments/${targetInstrument.id}`, {
        data: { allocation_node_id: targetLeaf.id }
      });
      expect(bindResp.ok()).toBeTruthy();

      await page.goto("/allocation");
      await expect(page.getByText("资产层级配置")).toBeVisible();

      const targetTreeNode = page
        .locator('.ant-tree-treenode[role="treeitem"]')
        .filter({ hasText: targetLeaf.name })
        .locator(".tree-node-title")
        .first();
      await expect(targetTreeNode).toBeVisible();
      await safeClick(targetTreeNode);

      const editPanel = page
        .locator(".ant-card")
        .filter({ hasText: "资产层级配置" })
        .first()
        .locator(".allocation-panel")
        .nth(1);
      await expect(editPanel.getByText("持仓标的配置")).toBeVisible();

      const instrumentRow = editPanel.locator(".ant-table-tbody tr").filter({ hasText: targetInstrument.symbol }).first();
      await expect(instrumentRow).toBeVisible();

      const currentChartCard = page
        .locator(".ant-card-head-title", { hasText: "当前层级资产结构" })
        .first()
        .locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-card ')][1]");
      await expect(currentChartCard.locator(".donut-legend-item").filter({ hasText: targetInstrument.symbol }).first()).toBeVisible();
    } finally {
      const rollbackResp = await request.patch(`/api/v1/instruments/${targetInstrument.id}`, {
        data: { allocation_node_id: originalAllocationNodeId }
      });
      expect(rollbackResp.ok()).toBeTruthy();
    }
  });

  test("node can be deleted from UI with confirmation", async ({ page, request }, testInfo) => {
    const unique = `${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${Date.now().toString().slice(-6)}`;
    const rootName = `删除测试根_${unique}`;
    const leafName = `删除测试叶_${unique}`;

    let rootNodeId: number | null = null;
    let leafNodeId: number | null = null;
    try {
      const createRootResp = await request.post("/api/v1/allocation/nodes", {
        data: {
          parent_id: null,
          name: rootName,
          target_weight: 0
        }
      });
      expect(createRootResp.ok()).toBeTruthy();
      rootNodeId = ((await createRootResp.json()) as AllocationNodeFixture).id;

      const createLeafResp = await request.post("/api/v1/allocation/nodes", {
        data: {
          parent_id: rootNodeId,
          name: leafName,
          target_weight: 100
        }
      });
      expect(createLeafResp.ok()).toBeTruthy();
      leafNodeId = ((await createLeafResp.json()) as AllocationNodeFixture).id;

      await page.goto("/allocation");
      await expect(page.getByText("资产层级配置")).toBeVisible();

      const targetLeafNode = page.locator(".tree-node-title").filter({ hasText: leafName }).first();
      await safeClick(targetLeafNode);

      const deleteButton = page.getByRole("button", { name: "删除当前节点" });
      await safeClick(deleteButton);
      const confirmDeleteButton = page.getByRole("button", { name: "确认删除" });
      await expect(confirmDeleteButton).toBeVisible();
      await safeClick(confirmDeleteButton);
      await expect(page.getByText("层级节点已删除")).toBeVisible();

      const leafQueryResp = await request.get("/api/v1/allocation/nodes");
      expect(leafQueryResp.ok()).toBeTruthy();
      const nodesAfterDelete = (await leafQueryResp.json()) as AllocationNodeFixture[];
      expect(nodesAfterDelete.some((item) => item.id === leafNodeId)).toBeFalsy();
      leafNodeId = null;
    } finally {
      if (leafNodeId !== null) {
        await request.delete(`/api/v1/allocation/nodes/${leafNodeId}`);
      }
      if (rootNodeId !== null) {
        await request.delete(`/api/v1/allocation/nodes/${rootNodeId}`);
      }
    }
  });

  test("node can add child leaf nodes", async ({ request }, testInfo) => {
    const unique = `${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${Date.now().toString().slice(-6)}`;
    const rootName = `可扩展根_${unique}`;
    const childName = `可扩展子节点_${unique}`;

    let rootNodeId: number | null = null;
    let childNodeId: number | null = null;
    try {
      const createRootResp = await request.post("/api/v1/allocation/nodes", {
        data: {
          parent_id: null,
          name: rootName,
          target_weight: 0
        }
      });
      expect(createRootResp.ok()).toBeTruthy();
      rootNodeId = ((await createRootResp.json()) as AllocationNodeFixture).id;

      const createChildResp = await request.post("/api/v1/allocation/nodes", {
        data: {
          parent_id: rootNodeId,
          name: childName,
          target_weight: 100
        }
      });
      expect(createChildResp.ok()).toBeTruthy();
      childNodeId = ((await createChildResp.json()) as AllocationNodeFixture).id;
    } finally {
      if (childNodeId !== null) {
        await request.delete(`/api/v1/allocation/nodes/${childNodeId}`);
      }
      if (rootNodeId !== null) {
        await request.delete(`/api/v1/allocation/nodes/${rootNodeId}`);
      }
    }
  });
});
