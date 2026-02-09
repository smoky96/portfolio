from enum import Enum


class AccountType(str, Enum):
    CASH = "CASH"
    BROKERAGE = "BROKERAGE"


class InstrumentType(str, Enum):
    STOCK = "STOCK"
    FUND = "FUND"


class TransactionType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    DIVIDEND = "DIVIDEND"
    FEE = "FEE"
    CASH_IN = "CASH_IN"
    CASH_OUT = "CASH_OUT"
    INTERNAL_TRANSFER = "INTERNAL_TRANSFER"


class QuoteProviderStatus(str, Enum):
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    MANUAL_OVERRIDE = "MANUAL_OVERRIDE"
