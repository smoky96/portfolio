import { AccountType, InstrumentType } from "../types";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CASH: "现金账户",
  BROKERAGE: "券商基金账户"
};

export const INSTRUMENT_TYPE_LABELS: Record<InstrumentType, string> = {
  STOCK: "股票",
  FUND: "基金"
};

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  BUY: "买入",
  SELL: "卖出",
  DIVIDEND: "分红",
  FEE: "费用",
  CASH_IN: "现金转入",
  CASH_OUT: "现金转出",
  INTERNAL_TRANSFER: "内部转账"
};

export const TRANSACTION_TYPE_OPTIONS = [
  { value: "BUY", label: TRANSACTION_TYPE_LABELS.BUY },
  { value: "SELL", label: TRANSACTION_TYPE_LABELS.SELL },
  { value: "DIVIDEND", label: TRANSACTION_TYPE_LABELS.DIVIDEND },
  { value: "FEE", label: TRANSACTION_TYPE_LABELS.FEE },
  { value: "CASH_IN", label: TRANSACTION_TYPE_LABELS.CASH_IN },
  { value: "CASH_OUT", label: TRANSACTION_TYPE_LABELS.CASH_OUT },
  { value: "INTERNAL_TRANSFER", label: TRANSACTION_TYPE_LABELS.INTERNAL_TRANSFER }
] as const;

export type NodeLevelLabel = "ROOT" | "BRANCH" | "LEAF";

export const NODE_LEVEL_LABELS: Record<NodeLevelLabel, string> = {
  ROOT: "根节点",
  BRANCH: "中间层",
  LEAF: "叶子层"
};
