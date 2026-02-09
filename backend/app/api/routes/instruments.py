from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Account, AllocationNode, Instrument
from app.schemas import InstrumentCreate, InstrumentRead, InstrumentUpdate
from app.services.allocation import ensure_leaf_node
from app.services.audit import write_audit_log

router = APIRouter()


def _validate_refs(db: Session, default_account_id: int | None, allocation_node_id: int | None) -> None:
    if default_account_id is not None and db.get(Account, default_account_id) is None:
        raise HTTPException(status_code=404, detail="Default account not found")
    if allocation_node_id is not None:
        if db.get(AllocationNode, allocation_node_id) is None:
            raise HTTPException(status_code=404, detail="Allocation node not found")
        ensure_leaf_node(db, allocation_node_id)


@router.get("", response_model=list[InstrumentRead])
def list_instruments(db: Session = Depends(get_db)) -> list[Instrument]:
    return list(db.scalars(select(Instrument).order_by(Instrument.id)))


@router.post("", response_model=InstrumentRead)
def create_instrument(payload: InstrumentCreate, db: Session = Depends(get_db)) -> Instrument:
    _validate_refs(db, payload.default_account_id, payload.allocation_node_id)

    instrument = Instrument(**payload.model_dump())
    db.add(instrument)
    db.flush()

    write_audit_log(
        db,
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
def update_instrument(instrument_id: int, payload: InstrumentUpdate, db: Session = Depends(get_db)) -> Instrument:
    instrument = db.get(Instrument, instrument_id)
    if not instrument:
        raise HTTPException(status_code=404, detail="Instrument not found")

    updates = payload.model_dump(exclude_unset=True)
    _validate_refs(
        db,
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
