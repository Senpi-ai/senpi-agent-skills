import { elizaLogger } from "@moxie-protocol/core";
import { gql } from "graphql-request";

export enum SourceType {
    AGENT = "AGENT",
    WIDGET = "WIDGET",
    AUTOMATION = "AUTOMATION",
    MANUAL = "MANUAL",
}

export enum ActionType {
    SWAP = "SWAP",
    SWAP_SL = "SWAP_SL",
    SWAP_SL_LO = "SWAP_SL_LO",
    LIMIT_ORDER = "LIMIT_ORDER",
    STOP_LOSS = "STOP_LOSS",
    STOP_LOSS_LO = "STOP_LOSS_LO",
}

export enum OpenOrderType {
    LIMIT_ORDER = "LIMIT_ORDER",
    STOP_LOSS = "STOP_LOSS",
}

export enum TriggerType {
    PERCENTAGE = "PERCENTAGE",
    TOKEN_PRICE = "TOKEN_PRICE",
}

export interface SwapInput {
    sellTokenAddress: string;
    buyTokenAddress: string;
    amount: string;
    slippage?: number;
    chainId: number;
}

export interface OpenOrderInput {
    sellAmountInWEI: string;
    sellAmount: string;
    sellTokenAddress: string;
    sellTokenSymbol: string;
    buyAmount: string;
    buyAmountInWEI: string;
    buyTokenAddress: string;
    buyTokenSymbol: string;
    triggerValue: string;
    triggerType: TriggerType;
    requestType?: OpenOrderType;
    chainId?: number;
    expiresAt?: string;
}

export interface CreateManualOrderInput {
    actionType: ActionType;
    sourceType: SourceType;
    swapInput: SwapInput;
    stopLossInput: OpenOrderInput;
    limitOrderInput: OpenOrderInput;
}

export interface CreateManualOrderOutput {
    success: boolean;
    error?: string;
    metadata: {
        traceId: string;
        orderId: string;
    };
}


const mutation = gql`
    mutation CreateManualOrder($createManualOrderInput: CreateManualOrderInput!) {
        CreateManualOrder(input: $createManualOrderInput) {
            success
            error
            metadata {
                traceId
                orderId
            }
        }
    }
`;


const errorMessages: Record<string, string> = {
    AERR001:
        "Some required fields are missing. Please make sure you've provided all the necessary details.",
    AERR002:
        "We couldn’t understand who should trigger the rule — is it an copy trade or a group copy trade?",
};

export function getErrorMessageFromCode(error: Error | string): string {
    const errorMsg = typeof error === "string" ? error : error.message;
    const match = errorMsg.match(/(AERR\d{3})/);
    const code = match?.[1];
    if (code && errorMessages[code]) {
        return errorMessages[code];
    } else {
        return `Hi, I'd be happy to help you setup that auto-trade but we just need some more information first. \n&nbsp;\n

1. Make sure to specify who triggers the copy trade. Examples: if @[user] buys a token or if 2 people in #groupname.
2. Make sure to specify a trigger amount: e.g. if 2 people in #copytrade buy >$1000 of a token.
3. Make sure to specify a time period, e.g. "if 2 people in #copytrade buy >$1000 of a token within 30 minutes of each other..."
4. Make sure to specify an amount to buy for you: "if 2 people in #copytrade buy >$1000 of a token within 30 minutes of each other, buy me $400 of it..."
5. Optional: Let me know if you have any exit conditions, e.g. "and then sell all when the price increases by 30%, or sell when they sell"

\n&nbsp;\n
**Here is a fully formed complete auto-trade instruction:**
If 2 people in #copytrade buy >$1000 of a token within 30 minutes of each other, buy me $400 of it, and then sell when they sell or when the price has increased by 30%`;
    }
}

export async function createManualOrder(
    authorizationHeader: string,
    actionType: ActionType,
    sourceType: SourceType,
    swapInput: SwapInput,
    stopLossInput: OpenOrderInput,
    limitOrderInput: OpenOrderInput
): Promise<CreateManualOrderOutput> {
    // Ensure either stopLossInput or limitOrderInput is provided, but not both
    if (!stopLossInput && !limitOrderInput) {
        throw new Error(
            "Please provide either stopLossInput or limitOrderInput."
        );
    }

    if (stopLossInput && limitOrderInput) {
        throw new Error(
            "Provide only one: stopLossInput or limitOrderInput, not both."
        );
    }

    const createManualOrderInput: CreateManualOrderInput = {
        actionType,
        sourceType,
        swapInput,
        stopLossInput,
        limitOrderInput,
    };

    try {
        const response = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authorizationHeader,
            },
            body: JSON.stringify({
                query: mutation,
                variables: { createManualOrderInput },
            }),
        });

        const result = await response.json();

        if (result.errors) {
            throw new Error(
                `Failed to create manual order: ${result.errors[0].message}`
            );
        }

        return result.data.CreateManualOrder as CreateManualOrderOutput;
    } catch (error) {
        elizaLogger.error(`CreateManualOrder failed: ${error}`);
        throw new Error(`Error creating manual order: ${error.message}`);
    }
}

export const agentWalletNotFound = {
    text: `\nPlease make sure to set up your agent wallet first and try again.`,
};

export const delegateAccessNotFound = {
    text: `\nPlease make sure to set up your agent wallet first and try again. (delegate access not found)`,
};

export const moxieWalletClientNotFound = {
    text: `\nUnable to access moxie wallet details. Please ensure your moxie wallet is properly setup and try again.`,
};

export async function checkUserCommunicationPreferences(
    traceId: string,
    moxieUserId: string
): Promise<string | null> {
    try {
        const response = await fetch(process.env.MOXIE_API_URL_INTERNAL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: `
                    query GetUser {
                        GetUser(input: { userId: "${moxieUserId}" }) {
                            communicationPreference
                        }
                    }
                `,
            }),
        });

        if (!response.ok) {
            elizaLogger.error(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] Failed to fetch user preferences: ${response.statusText}`
            );
            return null;
        }

        const data = await response.json();
        elizaLogger.debug(
            traceId,
            `[STOP_LOSS] [${moxieUserId}] User communication preferences:`,
            data?.data?.GetUser?.communicationPreference
        );
        return data?.data?.GetUser?.communicationPreference;
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[STOP_LOSS] [${moxieUserId}] Error checking user preferences: ${error.message}`
        );
        return null;
    }
}
