from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AllocationNode, Instrument
from app.services.positions import list_holdings

TOLERANCE = Decimal("0.0001")
HUNDRED = Decimal("100")


def _validate_sum_to_hundred(weights: list[Decimal], scope: str) -> None:
    total = sum((Decimal(w) for w in weights), start=Decimal("0"))
    if abs(total - HUNDRED) > TOLERANCE:
        raise HTTPException(status_code=400, detail=f"{scope} target weights must sum to 100, got {total}")


def validate_node_sibling_weights(db: Session, parent_id: int | None) -> None:
    stmt = select(AllocationNode.target_weight).where(AllocationNode.parent_id == parent_id)
    weights = [Decimal(w) for w in db.scalars(stmt)]
    if not weights:
        return
    _validate_sum_to_hundred(weights, "Allocation node siblings")


def ensure_leaf_node(db: Session, node_id: int) -> None:
    has_child = db.scalar(select(AllocationNode.id).where(AllocationNode.parent_id == node_id).limit(1))
    if has_child is not None:
        raise HTTPException(status_code=400, detail="Instruments can only be attached to nodes without children")


def _node_path(node: AllocationNode, node_by_id: dict[int, AllocationNode]) -> str:
    path: list[str] = [node.name]
    current = node
    visited: set[int] = set()
    while current.parent_id is not None:
        if current.id in visited:
            raise HTTPException(status_code=400, detail="Allocation node cycle detected")
        visited.add(current.id)

        parent = node_by_id.get(current.parent_id)
        if parent is None:
            raise HTTPException(status_code=400, detail="Allocation node parent missing")
        path.insert(0, parent.name)
        current = parent
    return " / ".join(path)


def _node_path_weight(node: AllocationNode, node_by_id: dict[int, AllocationNode]) -> Decimal:
    weight = Decimal(node.target_weight)
    current = node
    visited: set[int] = set()
    while current.parent_id is not None:
        if current.id in visited:
            raise HTTPException(status_code=400, detail="Allocation node cycle detected")
        visited.add(current.id)

        parent = node_by_id.get(current.parent_id)
        if parent is None:
            raise HTTPException(status_code=400, detail="Allocation node parent missing")
        weight = weight * Decimal(parent.target_weight) / HUNDRED
        current = parent
    return weight


def compute_drift_items(
    db: Session,
    *,
    base_currency: str,
    total_assets: Decimal,
    threshold: Decimal,
) -> list[dict]:
    node_list = list(db.scalars(select(AllocationNode)))
    node_by_id = {n.id: n for n in node_list}
    parent_ids = {node.parent_id for node in node_list if node.parent_id is not None}
    leaf_nodes = [node for node in node_list if node.id not in parent_ids]

    holdings = list_holdings(db, base_currency)
    instrument_ids = [h["instrument_id"] for h in holdings]
    node_by_instrument: dict[int, int | None] = {}
    if instrument_ids:
        inst_stmt = select(Instrument.id, Instrument.allocation_node_id).where(Instrument.id.in_(instrument_ids))
        for inst_id, node_id in db.execute(inst_stmt).all():
            node_by_instrument[inst_id] = node_id

    actual_value_by_node: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for row in holdings:
        node_id = node_by_instrument.get(row["instrument_id"])
        if node_id is None:
            continue
        actual_value_by_node[node_id] += Decimal(row["market_value"])

    drifts: list[dict] = []
    for node in leaf_nodes:
        global_target_weight = _node_path_weight(node, node_by_id)
        actual_value = actual_value_by_node.get(node.id, Decimal("0"))

        actual_weight = actual_value / total_assets * HUNDRED if total_assets > 0 else Decimal("0")

        drift_pct = actual_weight - global_target_weight
        is_alerted = abs(drift_pct) >= threshold

        drifts.append(
            {
                "node_id": node.id,
                "name": _node_path(node, node_by_id),
                "target_weight": global_target_weight.quantize(Decimal("0.0001")),
                "actual_weight": actual_weight.quantize(Decimal("0.0001")),
                "drift_pct": drift_pct.quantize(Decimal("0.0001")),
                "is_alerted": is_alerted,
            }
        )

    drifts.sort(key=lambda x: abs(x["drift_pct"]), reverse=True)
    return drifts
