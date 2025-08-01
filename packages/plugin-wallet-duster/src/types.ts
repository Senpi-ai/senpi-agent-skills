import { z } from "zod";

export const TransferEthSchema = z.object({
    amount: z.number().min(0),
    toAddress: z.string(),
    isENS: z.boolean(),
});

export const DustRequestSchema = z.object({
    threshold: z.number().min(0).nullable().optional(),
    isConfirmed: z.boolean().nullable().optional(),
});

export interface GetQuoteResponse {
    blockNumber: string;
    buyAmount: string;
    buyToken: string;
    sellAmount: string;
    sellToken: string;
    minBuyAmount: string;
    liquidityAvailable: boolean;
    totalNetworkFee: string;
    zid: string;
    fees: {
        zeroExFee: {
            amount: string;
            token: string;
            type: string;
        } | null;
        integratorFee: {
            amount: string;
            token: string;
            type: string;
        } | null;
        gasFee: {
            amount: string;
            token: string;
            type: string;
        } | null;
    };
    issues: {
        allowance: null;
        balance: {
            token: string;
            actual: string;
            expected: string;
        } | null;
        simulationIncomplete: boolean;
        invalidSourcesPassed: string[];
    };
    permit2: {
        type: "Permit2";
        hash: string;
        eip712: {
            types: Record<string, any>;
            domain: Record<string, any>;
            message: Record<string, any>;
            primaryType: string;
        };
    };
    route: {
        fills: Array<{
            from: string;
            to: string;
            source: string;
            proportionBps: string;
        }>;
        tokens: Array<{
            address: string;
            symbol: string;
        }>;
    };
    tokenMetadata: {
        buyToken: {
            buyTaxBps: string;
            sellTaxBps: string;
        };
        sellToken: {
            buyTaxBps: string;
            sellTaxBps: string;
        };
    };
    transaction: {
        to: string;
        data: string;
        gas: string;
        gasPrice: string;
        value: string;
    };
}

export interface CreateManualOrderInput {
    actionType: ActionType;
    source: Source;
    swapInput?: SwapInput;
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
    buyPrice?: string;
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
    };
};

// Use union type for simple string literals
export enum Source {
    AGENT = "AGENT",
    WIDGET = "WIDGET",
    AUTOMATION = "AUTOMATION",
    MANUAL = "MANUAL",
}

export enum ActionType {
    SWAP = "SWAP",
    SWAP_SL = "SWAP_SL",
    SWAP_SL_LO = "SWAP_SL_LO",
    SWAP_LO = "SWAP_LO",
    LO = "LO",
    SL = "SL",
    SL_LO = "SL_LO",
}

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
