import { State } from "@moxie-protocol/core";
import { IAgentRuntime } from "@moxie-protocol/core";
import { ethers } from "ethers";

// Use interface for object shapes that might be extended
export interface Context {
    traceId: string;
    moxieUserId?: string;
    runtime: IAgentRuntime;
    state: State;
    provider?: ethers.JsonRpcProvider;
    [key: string]: any;
}

// Use enums for string literals
export enum ValueType {
    USD = "USD",
}

export enum OrderType {
    BUY = "BUY",
    SELL = "SELL",
    STOP_LOSS = "STOP_LOSS",
    LIMIT_ORDER_BUY = "LIMIT_ORDER_BUY",
    LIMIT_ORDER_SELL = "LIMIT_ORDER_SELL",
}

export enum OrderScope {
    GLOBAL = "GLOBAL",
    RELATED = "RELATED",
}

export enum ExecutionType {
    IMMEDIATE = "IMMEDIATE",
    FUTURE = "FUTURE",
}

export enum BalanceType {
    FULL = "FULL",
    PERCENTAGE = "PERCENTAGE",
    QUANTITY = "QUANTITY",
}

export enum ActionType {
    SWAP = "SWAP",
    SWAP_SL = "SWAP_SL",
    SWAP_SL_LO = "SWAP_SL_LO",
    LO = "LO",
    SL = "SL",
    SL_LO = "SL_LO",
}

export enum TriggerType {
    PERCENTAGE = "PERCENTAGE",
    ABSOLUTE_VALUE = "ABSOLUTE_VALUE",
    VALUE_PRICE_INCREASE = "VALUE_PRICE_INCREASE",
    VALUE_PRICE_DROP = "VALUE_PRICE_DROP",
}

// Use interface for complex object shapes
export interface Transaction {
    sellToken: string;
    buyToken: string;
    sellQuantity: number | null;
    buyQuantity: number | null;
    valueType: ValueType;
    orderType: OrderType;
    orderScope: OrderScope | null;
    executionType: ExecutionType;
    triggerType: TriggerType | null;
    triggerPrice: number | null;
    expiration_time: string | null;
    balance: {
        sourceToken: string;
        type: BalanceType;
        value: number;
    };
}

// Use interface for API response shapes
export interface SenpiOrdersResponse {
    success: boolean;
    action: ActionType;
    is_followup: boolean;
    transactions: Transaction[];
    error: SenpiOrdersError | null;
}

// Use interface for error shapes
export interface SenpiOrdersError {
    success: false;
    error: {
        missing_fields: string[];
        prompt_message: string;
    };
}

// Keep enums for complex values or when you need reverse mapping
export enum OrderTriggerType {
    PERCENTAGE = "PERCENTAGE",
    TOKEN_PRICE = "TOKEN_PRICE",
}

export enum RequestType {
    STOP_LOSS = "STOP_LOSS",
    LIMIT_ORDER = "LIMIT_ORDER",
}

// Use interface for input contracts
export interface SwapInput {
    sellTokenAddress: string;
    buyTokenAddress: string;
    amount: string;
    slippage?: number;
    chainId: number;
    sellTokenSymbol: string;
    buyTokenSymbol: string;
    sellTokenDecimal: number;
    buyTokenDecimal: number;
}

// Use interface for complex input shapes
export interface OpenOrderInput {
    sellAmountInWei?: string;
    sellAmount?: string;
    sellTokenAddress: string;
    sellTokenSymbol: string;
    sellTokenDecimals: number;
    buyTokenDecimals: number;
    buyAmount?: string;
    buyAmountInWei?: string;
    buyTokenAddress: string;
    buyTokenSymbol: string;
    sellPercentage?: string;
    triggerValue: string;
    triggerType: OrderTriggerType;
    requestType?: RequestType;
    chainId?: number;
    expiresAt?: string;
}


// Use union type for simple string literals
export enum Source {
    AGENT = "AGENT",
    WIDGET = "WIDGET",
    AUTOMATION = "AUTOMATION",
    MANUAL = "MANUAL",
}

// Use interface for complex input shapes
export interface CreateManualOrderInput {
    actionType: ActionType;
    source: Source;
    swapInput?: SwapInput;
    stopLossInput?: OpenOrderInput[];
    limitOrderInput?: OpenOrderInput[];
}

// Use type for simple object shapes (could be interface too)
export type SwapOutput = {
    txHash: string;
    buyAmount: string;
    sellAmount: string;
    status: string;
    buyAmountInUSD?: string;
    sellAmountInUSD?: string;
    closedOrderId?: string;
    sellTriggerLedgerId?: string;
};

// Use type for simple object shapes
export type StopLossOutput = {
    subscriptionId: string;
    stopLossPrice: string;
    sellAmount: string;
    sellTokenSymbol: string;
    sellTokenAddress: string;
    status: string;
    expiresAt?: string;
    triggerType: string;
    triggerValue: string;
    openOrderId?: string;
};

// Use type for simple object shapes
export type LimitOrderOutput = {
    limitOrderId: string;
    limitPrice: string;
    buyAmount: string;
    sellAmount: string;
    status: string;
    expiresAt?: string;
    triggerType: string;
    triggerValue: string;
    openOrderId?: string;
};

// Use type for complex nested shapes
export type CreateManualOrderOutput = {
    success: boolean;
    error?: string;
    metadata: {
        traceId: string;
        orderId: string;
        ruleId?: string;
        ruleExecutionLogId?: string;
        swapOutput?: SwapOutput;
        stopLossOutputs?: StopLossOutput[];
        limitOrderOutputs?: LimitOrderOutput[];
    };
};