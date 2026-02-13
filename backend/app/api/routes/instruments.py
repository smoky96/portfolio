from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.models import Account, AllocationNode, Instrument
from app.schemas import InstrumentCreate, InstrumentRead, InstrumentUpdate
from app.services.allocation import ensure_leaf_node
from app.services.audit import write_audit_log

router = APIRouter()


def _validate_refs(
    db: Session,
    owner_id: int,
    default_account_id: int | None,
    allocation_node_id: int | None,
) -> None:
    if default_account_id is not None and db.scalar(select(Account.id).where(Account.id == default_account_id, Account.owner_id == owner_id)) is None:
        raise HTTPException(status_code=404, detail="Default account not found")
    if allocation_node_id is not None:
        if db.scalar(select(AllocationNode.id).where(AllocationNode.id == allocation_node_id, AllocationNode.owner_id == owner_id)) is None:
            raise HTTPException(status_code=404, detail="Allocation node not found")
        ensure_leaf_node(db, allocation_node_id, owner_id)


@router.get("", response_model=list[InstrumentRead])
def list_instruments(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Instrument]:
    return list(
        db.scalars(
            select(Instrument)
            .where(Instrument.owner_id == current_user.id)
            .order_by(Instrument.id)
        )
    )


@router.post("", response_model=InstrumentRead)
def create_instrument(
    payload: InstrumentCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Instrument:
    _validate_refs(db, current_user.id, payload.default_account_id, payload.allocation_node_id)

    instrument = Instrument(owner_id=current_user.id, **payload.model_dump())
    db.add(instrument)
    db.flush()

    write_audit_log(
        db,
        owner_id=current_user.id,
        actor_user_id=current_user.id,
        entity="instrument",
        entity_id=str(instrument.id),
        action="CREATE",
        before_state=None,
        after_state=payload.model_dump(mode="json"),
    )

    db.commit()
    db.refresh(instrument)
    return instrument


@router.patch("/{instrument_id}", response_model=InstrumentRead)
def update_instrument(
    instrument_id: int,
    payload: InstrumentUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Instrument:
    instrument = db.scalar(select(Instrument).where(Instrument.id == instrument_id, Instrument.owner_id == current_user.id))
    if not instrument:
        raise HTTPException(status_code=404, detail="Instrument not found")

    updates = payload.model_dump(exclude_unset=True)
    _validate_refs(
        db,
        current_user.id,
        updates.get("default_account_id", instrument.default_account_id),
        updates.get("allocation_node_id", instrument.allocation_node_id),
    )

    before = {
        "symbol": instrument.symbol,
        "market": instrument.market,
        "type": instrument.type.value,
        "currency": instrument.currency,
        "name": instrument.name,
        "default_account_id": instrument.default_account_id,
        "allocation_node_id": instrument.allocation_node_id,
    }

    for key, value in updates.items():
        setattr(instrument, key, value)

    write_audit_log(
        db,
        owner_id=current_user.id,
        actor_user_id=current_user.id,
        entity="instrument",
        entity_id=str(instrument.id),
        action="UPDATE",
        before_state=before,
        after_state={
            "symbol": instrument.symbol,
            "market": instrument.market,
            "type": instrument.type.value,
            "currency": instrument.currency,
            "name": instrument.name,
            "default_account_id": instrument.default_account_id,
            "allocation_node_id": instrument.allocation_node_id,
        },
    )

    db.commit()
    db.refresh(instrument)
    return instrument
