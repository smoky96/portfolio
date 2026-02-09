export type AccountType = "CASH" | "BROKERAGE";
export type InstrumentType = "STOCK" | "FUND";

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  base_currency: string;
  is_active: boolean;
}

export interface AllocationNode {
  id: number;
  parent_id: number | null;
  name: string;
  target_weight: string;
  order_index: number;
}

export interface AllocationTagGroup {
  id: number;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface AllocationTag {
  id: number;
  group_id: number;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface InstrumentTagSelection {
  id: number;
  instrument_id: number;
  group_id: number;
  tag_id: number;
  updated_at: string;
}

export interface Instrument {
  id: number;
  symbol: string;
  market: string;
  type: InstrumentType;
  currency: string;
  name: string;
  default_account_id: number | null;
  allocation_node_id: number | null;
}

export interface Transaction {
  id: number;
  type: string;
  account_id: number;
  instrument_id: number | null;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  tax: string;
  currency: string;
  executed_at: string;
  executed_tz: string;
  transfer_group_id: string | null;
  note: string | null;
}

export interface Holding {
  account_id: number;
  instrument_id: number;
  symbol: string;
  instrument_name: string;
  quantity: string;
  avg_cost: string;
  market_price: string;
  market_value: string;
  cost_value: string;
  unrealized_pnl: string;
  currency: string;
}

export interface DriftItem {
  node_id: number;
  name: string;
  target_weight: string;
  actual_weight: string;
  drift_pct: string;
  is_alerted: boolean;
}

export interface DashboardSummary {
  base_currency: string;
  total_assets: string;
  total_cash: string;
  total_market_value: string;
  account_balances: {
    account_id: number;
    account_name: string;
    account_currency: string;
    native_cash_balance: string;
    base_cash_balance: string;
  }[];
  drift_alerts: DriftItem[];
}

export interface ReturnCurvePoint {
  date: string;
  net_contribution: string;
  total_assets: string;
  total_return: string;
  total_return_rate: string | null;
}

export interface ManualPriceOverride {
  id: number;
  instrument_id: number;
  price: string;
  currency: string;
  overridden_at: string;
  operator: string;
  reason: string | null;
}

export interface LatestQuote {
  instrument_id: number;
  price: string | null;
  currency: string | null;
  source: string | null;
}

export interface YahooLookupQuote {
  symbol: string;
  matched_symbol: string | null;
  found: boolean;
  provider_status: string;
  name: string | null;
  price: string | null;
  currency: string | null;
  market: string | null;
  quote_type: string | null;
  quoted_at: string | null;
  message: string | null;
}
