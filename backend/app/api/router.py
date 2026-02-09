from fastapi import APIRouter

from app.api.routes import accounts, allocation, dashboard, holdings, instruments, quotes, rebalance, transactions

api_router = APIRouter()
api_router.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
api_router.include_router(allocation.router, prefix="/allocation", tags=["allocation"])
api_router.include_router(instruments.router, prefix="/instruments", tags=["instruments"])
api_router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
api_router.include_router(holdings.router, prefix="/holdings", tags=["holdings"])
api_router.include_router(rebalance.router, prefix="/rebalance", tags=["rebalance"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(quotes.router, prefix="/quotes", tags=["quotes"])
