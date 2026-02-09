from __future__ import annotations

from decimal import Decimal, ROUND_DOWN

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import AllocationNode, AllocationTag, AllocationTagGroup, Instrument, InstrumentTagSelection
from app.schemas import (
    AllocationTagCreate,
    AllocationTagGroupCreate,
    AllocationTagGroupRead,
    AllocationTagGroupUpdate,
    AllocationTagRead,
    AllocationTagUpdate,
    AllocationNodeBatchWeightsUpdate,
    AllocationNodeCreate,
    AllocationNodeRead,
    AllocationNodeUpdate,
    InstrumentTagSelectionRead,
    InstrumentTagSelectionUpsert,
)
from app.services.allocation import validate_node_sibling_weights
from app.services.audit import write_audit_log

router = APIRouter()


def _node_or_404(db: Session, node_id: int) -> AllocationNode:
    node = db.get(AllocationNode, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Allocation node not found")
    return node


def _tag_group_or_404(db: Session, group_id: int) -> AllocationTagGroup:
    group = db.get(AllocationTagGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Tag group not found")
    return group


def _tag_or_404(db: Session, tag_id: int) -> AllocationTag:
    tag = db.get(AllocationTag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


def _instrument_or_404(db: Session, instrument_id: int) -> Instrument:
    instrument = db.get(Instrument, instrument_id)
    if not instrument:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return instrument


def _is_descendant(db: Session, root_node_id: int, candidate_parent_id: int) -> bool:
    frontier = [root_node_id]
    while frontier:
        current = frontier.pop()
        children = list(db.scalars(select(AllocationNode.id).where(AllocationNode.parent_id == current)))
        if candidate_parent_id in children:
            return True
        frontier.extend(children)
    return False


def _rebalance_sibling_weights(db: Session, parent_id: int | None) -> None:
    siblings = list(
        db.scalars(
            select(AllocationNode)
            .where(AllocationNode.parent_id == parent_id)
            .order_by(AllocationNode.order_index, AllocationNode.id)
        )
    )
    if not siblings:
        return

    if len(siblings) == 1:
        siblings[0].target_weight = Decimal("100")
        return

    total = sum((Decimal(item.target_weight) for item in siblings), start=Decimal("0"))
    if total <= Decimal("0"):
        each = (Decimal("100") / Decimal(len(siblings))).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)
        assigned = Decimal("0")
        for item in siblings[:-1]:
            item.target_weight = each
            assigned += each
        siblings[-1].target_weight = Decimal("100") - assigned
        return

    assigned = Decimal("0")
    for item in siblings[:-1]:
        normalized = (Decimal(item.target_weight) / total * Decimal("100")).quantize(
            Decimal("0.0001"),
            rounding=ROUND_DOWN,
        )
        item.target_weight = normalized
        assigned += normalized
    siblings[-1].target_weight = Decimal("100") - assigned


def _collect_subtree_node_ids(db: Session, root_node_id: int) -> list[int]:
    pending = [root_node_id]
    ordered: list[int] = []
    visited: set[int] = set()

    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        ordered.append(current)
        children = list(db.scalars(select(AllocationNode.id).where(AllocationNode.parent_id == current)))
        pending.extend(children)

    return ordered


@router.get("/nodes", response_model=list[AllocationNodeRead])
def list_nodes(db: Session = Depends(get_db)) -> list[AllocationNode]:
    return list(db.scalars(select(AllocationNode).order_by(AllocationNode.parent_id, AllocationNode.order_index, AllocationNode.id)))


@router.post("/nodes", response_model=AllocationNodeRead)
def create_node(payload: AllocationNodeCreate, db: Session = Depends(get_db)) -> AllocationNode:
    if payload.parent_id is not None:
        _node_or_404(db, payload.parent_id)

    node = AllocationNode(**payload.model_dump())
    db.add(node)
    db.flush()

    moved_instruments = 0
    if payload.parent_id is not None:
        has_sibling_child = db.scalar(
            select(AllocationNode.id).where(AllocationNode.parent_id == payload.parent_id, AllocationNode.id != node.id).limit(1)
        )
        if has_sibling_child is None:
            move_result = db.execute(
                update(Instrument)
                .where(Instrument.allocation_node_id == payload.parent_id)
                .values(allocation_node_id=node.id)
            )
            moved_instruments = int(move_result.rowcount or 0)

    validate_node_sibling_weights(db, payload.parent_id)

    write_audit_log(
        db,
        entity="allocation_node",
        entity_id=str(node.id),
        action="CREATE",
        before_state=None,
        after_state={
            **payload.model_dump(mode="json"),
            "auto_moved_instruments": moved_instruments,
        },
    )

    db.commit()
    db.refresh(node)
    return node


@router.patch("/nodes/{node_id}", response_model=AllocationNodeRead)
def update_node(node_id: int, payload: AllocationNodeUpdate, db: Session = Depends(get_db)) -> AllocationNode:
    node = _node_or_404(db, node_id)
    before_parent_id = node.parent_id
    before = {
        "parent_id": node.parent_id,
        "name": node.name,
        "target_weight": str(node.target_weight),
        "order_index": node.order_index,
    }

    updates = payload.model_dump(exclude_unset=True)
    if "parent_id" in updates:
        new_parent_id = updates["parent_id"]
        if new_parent_id == node.id:
            raise HTTPException(status_code=400, detail="Node cannot be parent of itself")
        if new_parent_id is not None:
            _node_or_404(db, new_parent_id)
            if _is_descendant(db, node.id, new_parent_id):
                raise HTTPException(status_code=400, detail="Node cannot move under its descendant")

    for key, value in updates.items():
        setattr(node, key, value)

    db.flush()
    validate_node_sibling_weights(db, node.parent_id)
    if before_parent_id != node.parent_id:
        validate_node_sibling_weights(db, before_parent_id)

    write_audit_log(
        db,
        entity="allocation_node",
        entity_id=str(node.id),
        action="UPDATE",
        before_state=before,
        after_state={
            "parent_id": node.parent_id,
            "name": node.name,
            "target_weight": str(node.target_weight),
            "order_index": node.order_index,
        },
    )

    db.commit()
    db.refresh(node)
    return node


@router.patch("/nodes/weights/batch", response_model=list[AllocationNodeRead])
def batch_update_node_weights(payload: AllocationNodeBatchWeightsUpdate, db: Session = Depends(get_db)) -> list[AllocationNode]:
    siblings = list(
        db.scalars(
            select(AllocationNode)
            .where(AllocationNode.parent_id == payload.parent_id)
            .order_by(AllocationNode.order_index, AllocationNode.id)
        )
    )
    if not siblings:
        raise HTTPException(status_code=404, detail="Allocation sibling group not found")

    sibling_ids = {item.id for item in siblings}
    payload_ids = {item.id for item in payload.items}
    if payload_ids != sibling_ids:
        raise HTTPException(
            status_code=400,
            detail="Payload must include all sibling nodes in the selected parent group",
        )

    updates = {item.id: item for item in payload.items}
    before_map: dict[int, dict] = {}
    for node in siblings:
        before_map[node.id] = {
            "parent_id": node.parent_id,
            "name": node.name,
            "target_weight": str(node.target_weight),
            "order_index": node.order_index,
        }
        node.target_weight = updates[node.id].target_weight

    db.flush()
    validate_node_sibling_weights(db, payload.parent_id)

    for node in siblings:
        write_audit_log(
            db,
            entity="allocation_node",
            entity_id=str(node.id),
            action="UPDATE",
            before_state=before_map[node.id],
            after_state={
                "parent_id": node.parent_id,
                "name": node.name,
                "target_weight": str(node.target_weight),
                "order_index": node.order_index,
            },
        )

    db.commit()
    for node in siblings:
        db.refresh(node)
    return siblings


@router.delete("/nodes/{node_id}")
def delete_node(node_id: int, db: Session = Depends(get_db)) -> dict:
    node = _node_or_404(db, node_id)

    parent_id = node.parent_id
    before = {
        "parent_id": node.parent_id,
        "name": node.name,
        "target_weight": str(node.target_weight),
        "order_index": node.order_index,
    }

    subtree_node_ids = _collect_subtree_node_ids(db, node_id)

    unbind_result = db.execute(
        update(Instrument)
        .where(Instrument.allocation_node_id.in_(subtree_node_ids))
        .values(allocation_node_id=None)
    )
    unbound_instruments = int(unbind_result.rowcount or 0)

    db.execute(delete(AllocationNode).where(AllocationNode.id.in_(subtree_node_ids)))
    db.flush()

    _rebalance_sibling_weights(db, parent_id)
    db.flush()
    validate_node_sibling_weights(db, parent_id)

    write_audit_log(
        db,
        entity="allocation_node",
        entity_id=str(node_id),
        action="DELETE",
        before_state=before,
        after_state={
            "deleted_subtree_nodes": len(subtree_node_ids),
            "unbound_instruments": unbound_instruments,
        },
    )

    db.commit()
    return {"deleted": True, "deleted_nodes": len(subtree_node_ids), "unbound_instruments": unbound_instruments}


@router.get("/tag-groups", response_model=list[AllocationTagGroupRead])
def list_tag_groups(db: Session = Depends(get_db)) -> list[AllocationTagGroup]:
    return list(db.scalars(select(AllocationTagGroup).order_by(AllocationTagGroup.order_index, AllocationTagGroup.id)))


@router.post("/tag-groups", response_model=AllocationTagGroupRead)
def create_tag_group(payload: AllocationTagGroupCreate, db: Session = Depends(get_db)) -> AllocationTagGroup:
    group = AllocationTagGroup(**payload.model_dump())
    db.add(group)
    db.flush()

    write_audit_log(
        db,
        entity="allocation_tag_group",
        entity_id=str(group.id),
        action="CREATE",
        before_state=None,
        after_state=payload.model_dump(mode="json"),
    )

    db.commit()
    db.refresh(group)
    return group


@router.patch("/tag-groups/{group_id}", response_model=AllocationTagGroupRead)
def update_tag_group(group_id: int, payload: AllocationTagGroupUpdate, db: Session = Depends(get_db)) -> AllocationTagGroup:
    group = _tag_group_or_404(db, group_id)
    before = {"name": group.name, "order_index": group.order_index}

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, key, value)

    write_audit_log(
        db,
        entity="allocation_tag_group",
        entity_id=str(group.id),
        action="UPDATE",
        before_state=before,
        after_state={"name": group.name, "order_index": group.order_index},
    )

    db.commit()
    db.refresh(group)
    return group


@router.delete("/tag-groups/{group_id}")
def delete_tag_group(group_id: int, db: Session = Depends(get_db)) -> dict:
    group = _tag_group_or_404(db, group_id)
    before = {"name": group.name, "order_index": group.order_index}

    db.execute(delete(InstrumentTagSelection).where(InstrumentTagSelection.group_id == group_id))
    db.execute(delete(AllocationTag).where(AllocationTag.group_id == group_id))
    db.delete(group)

    write_audit_log(
        db,
        entity="allocation_tag_group",
        entity_id=str(group_id),
        action="DELETE",
        before_state=before,
        after_state=None,
    )

    db.commit()
    return {"deleted": True}


@router.get("/tags", response_model=list[AllocationTagRead])
def list_tags(
    group_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[AllocationTag]:
    stmt = select(AllocationTag)
    if group_id is not None:
        stmt = stmt.where(AllocationTag.group_id == group_id)
    stmt = stmt.order_by(AllocationTag.group_id, AllocationTag.order_index, AllocationTag.id)
    return list(db.scalars(stmt))


@router.post("/tags", response_model=AllocationTagRead)
def create_tag(payload: AllocationTagCreate, db: Session = Depends(get_db)) -> AllocationTag:
    _tag_group_or_404(db, payload.group_id)

    tag = AllocationTag(**payload.model_dump())
    db.add(tag)
    db.flush()

    write_audit_log(
        db,
        entity="allocation_tag",
        entity_id=str(tag.id),
        action="CREATE",
        before_state=None,
        after_state=payload.model_dump(mode="json"),
    )

    db.commit()
    db.refresh(tag)
    return tag


@router.patch("/tags/{tag_id}", response_model=AllocationTagRead)
def update_tag(tag_id: int, payload: AllocationTagUpdate, db: Session = Depends(get_db)) -> AllocationTag:
    tag = _tag_or_404(db, tag_id)
    updates = payload.model_dump(exclude_unset=True)
    target_group_id = updates.get("group_id", tag.group_id)
    _tag_group_or_404(db, target_group_id)

    before = {"group_id": tag.group_id, "name": tag.name, "order_index": tag.order_index}
    for key, value in updates.items():
        setattr(tag, key, value)

    if "group_id" in updates:
        db.execute(
            delete(InstrumentTagSelection).where(
                InstrumentTagSelection.tag_id == tag.id,
                InstrumentTagSelection.group_id != tag.group_id,
            )
        )

    write_audit_log(
        db,
        entity="allocation_tag",
        entity_id=str(tag.id),
        action="UPDATE",
        before_state=before,
        after_state={"group_id": tag.group_id, "name": tag.name, "order_index": tag.order_index},
    )

    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)) -> dict:
    tag = _tag_or_404(db, tag_id)
    before = {"group_id": tag.group_id, "name": tag.name, "order_index": tag.order_index}

    db.execute(delete(InstrumentTagSelection).where(InstrumentTagSelection.tag_id == tag_id))
    db.delete(tag)

    write_audit_log(
        db,
        entity="allocation_tag",
        entity_id=str(tag_id),
        action="DELETE",
        before_state=before,
        after_state=None,
    )

    db.commit()
    return {"deleted": True}


@router.get("/instrument-tags", response_model=list[InstrumentTagSelectionRead])
def list_instrument_tags(db: Session = Depends(get_db)) -> list[InstrumentTagSelection]:
    return list(
        db.scalars(
            select(InstrumentTagSelection).order_by(
                InstrumentTagSelection.instrument_id,
                InstrumentTagSelection.group_id,
                InstrumentTagSelection.id,
            )
        )
    )


@router.put("/instrument-tags", response_model=InstrumentTagSelectionRead)
def upsert_instrument_tag_selection(payload: InstrumentTagSelectionUpsert, db: Session = Depends(get_db)) -> InstrumentTagSelection:
    _instrument_or_404(db, payload.instrument_id)
    _tag_group_or_404(db, payload.group_id)
    tag = _tag_or_404(db, payload.tag_id)
    if tag.group_id != payload.group_id:
        raise HTTPException(status_code=400, detail="Tag does not belong to selected group")

    selection = db.scalar(
        select(InstrumentTagSelection).where(
            InstrumentTagSelection.instrument_id == payload.instrument_id,
            InstrumentTagSelection.group_id == payload.group_id,
        )
    )

    if selection is None:
        selection = InstrumentTagSelection(**payload.model_dump())
        db.add(selection)
        db.flush()
        action = "CREATE"
        before_state = None
    else:
        before_state = {"instrument_id": selection.instrument_id, "group_id": selection.group_id, "tag_id": selection.tag_id}
        selection.tag_id = payload.tag_id
        db.flush()
        action = "UPDATE"

    write_audit_log(
        db,
        entity="instrument_tag_selection",
        entity_id=str(selection.id),
        action=action,
        before_state=before_state,
        after_state={"instrument_id": selection.instrument_id, "group_id": selection.group_id, "tag_id": selection.tag_id},
    )

    db.commit()
    db.refresh(selection)
    return selection


@router.delete("/instrument-tags/{instrument_id}/{group_id}")
def delete_instrument_tag_selection(instrument_id: int, group_id: int, db: Session = Depends(get_db)) -> dict:
    selection = db.scalar(
        select(InstrumentTagSelection).where(
            InstrumentTagSelection.instrument_id == instrument_id,
            InstrumentTagSelection.group_id == group_id,
        )
    )
    if selection is None:
        raise HTTPException(status_code=404, detail="Instrument tag selection not found")

    before = {"instrument_id": selection.instrument_id, "group_id": selection.group_id, "tag_id": selection.tag_id}
    selection_id = selection.id
    db.delete(selection)

    write_audit_log(
        db,
        entity="instrument_tag_selection",
        entity_id=str(selection_id),
        action="DELETE",
        before_state=before,
        after_state=None,
    )

    db.commit()
    return {"deleted": True}
