import { elizaLogger, HandlerCallback } from "@moxie-protocol/core";
import {
    CreateManualOrderInput,
    ActionType,
    CreateManualOrderOutput,
    Source,
    SwapInput,
} from "../types";
import { gql } from "graphql-request";
import { formatTokenMention } from "@moxie-protocol/moxie-agent-lib";

/**
 * GraphQL mutation for creating a manual order.
 */
const mutation = gql`
    mutation CreateManualOrder($createRuleInput: CreateManualOrderInput!) {
        CreateManualOrder(input: $createRuleInput) {
            success
            error
            metadata {
                traceId
                orderId
                ruleId
                ruleExecutionLogId
                swapOutput {
                    txHash
                    buyAmount
                    sellAmount
                    buyAmountInUSD
                    sellAmountInUSD
                    buyPrice
                }
            }
        }
    }
`;
/**
 * Creates a manual order by sending a GraphQL mutation request.
 *
 * @param authorizationHeader - The authorization token for the request.
 * @param actionType - The type of action to be performed.
 * @param source - The source of the order.
 * @param swapInput - The input details for a swap order.
 * @param stopLossInput - The input details for stop loss orders.
 * @param limitOrderInput - The input details for limit orders.
 * @returns A promise that resolves to the result of the CreateManualOrder mutation.
 * @throws Error if the request fails or if the response contains errors.
 */
export async function createManualOrder(
    authorizationHeader: string,
    actionType: ActionType,
    source: Source,
    swapInput: SwapInput | undefined,
    callback: HandlerCallback
): Promise<CreateManualOrderOutput> {
    if (
        !swapInput ||
        !swapInput.sellTokenSymbol ||
        !swapInput.sellTokenAddress ||
        !swapInput.buyTokenSymbol ||
        !swapInput.buyTokenAddress
    ) {
        elizaLogger.error(
            `[CREATE_MANUAL_ORDER] [${source}] [${actionType}] [${JSON.stringify(swapInput)}] Invalid swap request: Missing swap input parameters`
        );
        return {
            success: false,
            error: "Missing swap input parameters",
        };
    }

    await callback?.({
        text: `\n# Dusting ${formatTokenMention(swapInput.sellTokenSymbol, swapInput.sellTokenAddress)} to ${formatTokenMention(swapInput.buyTokenSymbol, swapInput.buyTokenAddress)}\n`,
    });

    elizaLogger.debug(
        `[CREATE_MANUAL_ORDER] [${source}] [${actionType}] [${JSON.stringify(swapInput)}]`
    );

    const createRuleInput: CreateManualOrderInput = {
        actionType,
        source,
        swapInput,
    };

    try {
        await callback?.({
            text: `\nDusting ${formatTokenMention(swapInput.sellTokenSymbol, swapInput.sellTokenAddress)} to ${formatTokenMention(swapInput.buyTokenSymbol, swapInput.buyTokenAddress)} is in progress.\n`,
        });

        const response = await fetch(process.env.MOXIE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authorizationHeader,
                Origin: process.env.ORIGIN_HEADER,
            },
            body: JSON.stringify({
                query: mutation,
                variables: { createRuleInput },
            }),
        });

        const result = await response?.json();

        elizaLogger.info(
            `[CREATE_MANUAL_ORDER] [${source}] [${actionType}] CreateManualOrder result: ${JSON.stringify(result)}`
        );

        if (
            !result?.data?.CreateManualOrder?.success ||
            !result?.data?.CreateManualOrder?.metadata?.swapOutput?.txHash
        ) {
            throw new Error(result?.data?.CreateManualOrder?.error);
        }

        await callback?.({
            text: `\nView transaction status on [BaseScan](https://basescan.org/tx/${result.data.CreateManualOrder.metadata.swapOutput.txHash}).\nDusting ${formatTokenMention(swapInput.sellTokenSymbol, swapInput.sellTokenAddress)} to ${formatTokenMention(swapInput.buyTokenSymbol, swapInput.buyTokenAddress)} completed successfully.\n`,
        });

        return result.data.CreateManualOrder as CreateManualOrderOutput;
    } catch (error) {
        elizaLogger.error(
            `[CREATE_MANUAL_ORDER] [${source}] [${actionType}] CreateManualOrder failed: ${error}`
        );
        await callback?.({
            text: `\nAn error occurred while processing your request. Please try again.`,
            content: {
                details: `An error occurred while processing your request. Please try again.`,
            },
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
