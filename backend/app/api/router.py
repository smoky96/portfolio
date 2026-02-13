from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.api.routes import accounts, admin, allocation, auth, dashboard, holdings, instruments, quotes, rebalance, transactions

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(accounts.router, prefix="/accounts", tags=["accounts"], dependencies=[Depends(get_current_user)])
api_router.include_router(allocation.router, prefix="/allocation", tags=["allocation"], dependencies=[Depends(get_current_user)])
api_router.include_router(instruments.router, prefix="/instruments", tags=["instruments"], dependencies=[Depends(get_current_user)])
api_router.include_router(transactions.router, prefix="/transactions", tags=["transactions"], dependencies=[Depends(get_current_user)])
api_router.include_router(holdings.router, prefix="/holdings", tags=["holdings"], dependencies=[Depends(get_current_user)])
api_router.include_router(rebalance.router, prefix="/rebalance", tags=["rebalance"], dependencies=[Depends(get_current_user)])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])
api_router.include_router(quotes.router, prefix="/quotes", tags=["quotes"], dependencies=[Depends(get_current_user)])
