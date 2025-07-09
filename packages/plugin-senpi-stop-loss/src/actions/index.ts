import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    type ActionExample,
    ModelClass,
    ModelProviderName,
    elizaLogger,
    composeContext,
    generateObjectDeprecated,
} from "@moxie-protocol/core";
import {
    MoxieClientWallet,
    MoxieUser,
    MoxieWalletClient,
    Portfolio,
} from "@moxie-protocol/moxie-agent-lib";
import {
    agentWalletNotFound,
    moxieWalletClientNotFound,
    checkUserCommunicationPreferences,
    createManualOrder,
    ActionType,
    Source,
    OpenOrderInput,
    TriggerType,
    OpenOrderType,
} from "../utils/utility";
import { stopLossTemplate } from "../templates";
import { DEFAULT_BUY_TOKEN, DEFAULT_BUY_TOKEN_DECIMALS, IGNORED_TOKENS } from "../constants/constants";
import { getERC20Balance, getERC20Decimals } from "../utils/erc20"; 
import { ethers } from "ethers";
import { isValidBaseAddress } from "../utils/utility";

/**
 * Interface representing a stop loss order request.
 */
export interface StopLossOrderRequest {
    token_address: string;
    token_symbol?: string;
    token_decimals: number;
    quantity_percentage: string;
    quantity_absolute?: string;
    stop_loss_trigger: "percentage" | "absolute_price" | "price_drop";
    stop_loss_value: string;
    expiry: string;
    buy_token: string;
    buy_token_decimals: number;
    buy_token_symbol?: string;
}

/**
 * Interface representing an error in stop loss processing.
 */
export interface StopLossError {
    missing_fields: string[];
    prompt_message: string;
}

/**
 * Interface representing the response of a stop loss action.
 */
export interface StopLossResponse {
    success: boolean;
    is_followup: boolean;
    params?: StopLossOrderRequest[];
    error: StopLossError | null;
}

/**
 * Action to handle stop loss orders.
 */
export const stopLossAction: Action = {
    name: "STOP_LOSS",
    similes: ["STOP_LOSS_ORDER"],
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Set a stop loss order for all my tokens if they drop by 10%",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Create a stop loss order to sell my tokens if they lose 15% in value",
                    action: "STOP_LOSS",
                },
            },
        ],
    ] as ActionExample[][],
    description:
        "Handles user intents related to placing stop loss orders on tokens they currently hold to prevent losses from price drops.",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        const traceId = message.id;
        const moxieUserInfo = state.moxieUserInfo as MoxieUser;
        const moxieUserId = moxieUserInfo.id;

        try {
            const tokenBalanceMap = new Map<string, string>();
            const tokenDecimalMap = new Map<string, number>();

            const agentWallet = state.agentWallet as MoxieClientWallet;
            if (!agentWallet) {
                await handleError(traceId, moxieUserId, agentWalletNotFound, callback);
                return true;
            }

            const walletClient = state.moxieWalletClient as MoxieWalletClient;
            if (!walletClient) {
                await handleError(traceId, moxieUserId, moxieWalletClientNotFound, callback);
                return true;
            }

            const communicationPreference = await checkUserCommunicationPreferences(traceId, moxieUserId);
            elizaLogger.debug(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] communicationPreference: ${communicationPreference}`
            );

            const tokens = getTokenBalances(state);
            elizaLogger.info(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] tokenBalances: ${JSON.stringify(tokens)}`
            );

            if (tokens.length === 0) {
                await handleNoTokensError(traceId, moxieUserId, callback);
                return true;
            }

            const newstate = await runtime.composeState(message, {
                tokenBalances: JSON.stringify(tokens),
            });

            const stopLossContext = composeContext({
                state: newstate,
                template: stopLossTemplate,
            });

            const stopLossResponse = await generateStopLossResponse(runtime, stopLossContext);
            if (!stopLossResponse.success) {
                await handleStopLossError(traceId, moxieUserId, stopLossResponse, callback);
                return true;
            }

            elizaLogger.info(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] stopLossResponse: ${JSON.stringify(stopLossResponse)}`
            );

            const { params } = stopLossResponse;
            if (!params || params.length === 0) {
                await handleNoParamsError(traceId, moxieUserId, callback);
                return true;
            }

            await processStopLossParams(params, traceId, moxieUserId, agentWallet, tokenBalanceMap, tokenDecimalMap, callback, state);
        } catch (error) {
            await handleUnexpectedError(traceId, moxieUserId, error, callback);
        }

        return true;
    },
};

/**
 * Handles errors by logging and invoking the callback with a predefined error message.
 */
async function handleError(traceId: string, moxieUserId: string, errorMessage: any, callback: HandlerCallback) {
    elizaLogger.error(traceId, `[STOP_LOSS] [${moxieUserId}] ${errorMessage}`);
    await callback?.(errorMessage);
}

/**
 * Retrieves token balances from the state.
 */
function getTokenBalances(state: State): any[] {
    const { tokenBalances }: Portfolio = (state.agentWalletBalance as Portfolio) ?? { tokenBalances: [] };
    return tokenBalances
        .filter(t => t.token.balanceUSD > 0 && !IGNORED_TOKENS.includes(t.token.baseToken.address.toLowerCase()))
        .sort((a, b) => b.token.balanceUSD - a.token.balanceUSD)
        .slice(0, 100)
        .map(t => ({
            address: t.token.baseToken.address.toLowerCase(),
            symbol: t.token.baseToken.symbol,
            balance: t.token.balance,
            balanceUSD: t.token.balanceUSD,
            tentativePrice: t.token.balanceUSD / t.token.balance,
        }));
}

/**
 * Handles the case where no tokens are found.
 * @param traceId - The trace ID of the request.
 * @param moxieUserId - The Moxie user ID.
 * @param callback - The callback function to handle the error.
 */
async function handleNoTokensError(traceId: string, moxieUserId: string, callback: HandlerCallback) {
    elizaLogger.warn(
        traceId,
        `[STOP_LOSS] [${moxieUserId}] No tokens found to setup stop loss on. Can't setup stop loss on ETH, USDC, USDT, etc.`
    );
    callback?.({
        text: "No tokens found to setup stop loss on. Can't setup stop loss on ETH, USDC, USDT, etc.",
        action: "STOP_LOSS",
    });
}

/**
 * Generates a stop loss response using the provided runtime and context.
 */
async function generateStopLossResponse(runtime: IAgentRuntime, context: any): Promise<StopLossResponse> {
    try {
        const response = await generateObjectDeprecated({
            runtime,
            context,
            modelClass: ModelClass.LARGE,
            modelConfigOptions: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                modelProvider: ModelProviderName.ANTHROPIC,
                apiKey: process.env.ANTHROPIC_API_KEY,
                modelClass: ModelClass.LARGE,
            },
        });
        return response as StopLossResponse;
    } catch (error) {
        elizaLogger.error("Error generating stop loss response:", error);
        throw new Error("Failed to generate stop loss response");
    }
}

/**
 * Handles stop loss errors by logging and invoking the callback with an error message.
 */
async function handleStopLossError(traceId: string, moxieUserId: string, stopLossResponse: StopLossResponse, callback: HandlerCallback) {
    let errorMessage = "Something went wrong while creating stop loss rule. Please try again later.";
    if (stopLossResponse.error && stopLossResponse.error.prompt_message) {
        errorMessage = stopLossResponse.error.prompt_message;
    }
    elizaLogger.warn(
        traceId,
        `[STOP_LOSS] [${moxieUserId}] error while fetching agent stop loss params: ${JSON.stringify(stopLossResponse)}`
    );
    callback?.({
        text: errorMessage,
        action: "STOP_LOSS",
    });
}

/**
 * Handles the case where no stop loss parameters are found.
 */
async function handleNoParamsError(traceId: string, moxieUserId: string, callback: HandlerCallback) {
    elizaLogger.warn(
        traceId,
        `[STOP_LOSS] [${moxieUserId}] No stop loss rules found. Please provide a valid stop loss rule.`
    );
    callback?.({
        text: "No stop loss rules found. Please try again.",
        action: "STOP_LOSS",
    });
}

/**
 * Processes each stop loss parameter and creates manual orders.
 */
async function processStopLossParams(
    params: StopLossOrderRequest[],
    traceId: string,
    moxieUserId: string,
    agentWallet: MoxieClientWallet,
    tokenBalanceMap: Map<string, string>,
    tokenDecimalMap: Map<string, number>,
    callback: HandlerCallback,
    state: State
) {
    for (const param of params) {

        callback?.({
            text: `Creating stop loss order for token $[${param.token_symbol ? param.token_symbol : param.token_address}|${param.token_address}]...\n`,
            action: "STOP_LOSS",
        });

        validateStopLossParam(param, traceId, moxieUserId);

        const tokenSymbol = param.token_symbol;
        const tokenAddress = param.token_address;
        const quantityPercentageValue = parseFloat(param.quantity_percentage)/100;

        let sellTokenBalanceInWEI = await getSellTokenBalanceInWEI(traceId, tokenAddress, agentWallet, tokenBalanceMap, moxieUserId);

        if (sellTokenBalanceInWEI === "0") {
            elizaLogger.warn(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] No balance found for token ${tokenAddress}`
            );
            continue;
        }

        let sellTokenDecimals = await getSellTokenDecimals(traceId, tokenAddress, tokenDecimalMap, moxieUserId);

        let sellTokenBalanceInWEIBigInt = BigInt(sellTokenBalanceInWEI);
        sellTokenBalanceInWEIBigInt = applyPercentage(sellTokenBalanceInWEIBigInt, quantityPercentageValue);
        sellTokenBalanceInWEI = sellTokenBalanceInWEIBigInt.toString();

        const sellTokenBalance = ethers.formatUnits(sellTokenBalanceInWEI, sellTokenDecimals);

        const openOrderInput: OpenOrderInput = {
            sellAmountInWei: sellTokenBalanceInWEI.toString(),
            sellAmount: sellTokenBalance.toString(),
            sellTokenAddress: tokenAddress,
            sellTokenSymbol: tokenSymbol,
            sellTokenDecimals: Number(sellTokenDecimals),
            buyTokenAddress: param.buy_token,
            buyTokenSymbol: param.buy_token_symbol ?? DEFAULT_BUY_TOKEN,
            buyTokenDecimals: param.buy_token_decimals ?? DEFAULT_BUY_TOKEN_DECIMALS,
            triggerValue: param.stop_loss_value,
            triggerType: param.stop_loss_trigger === "percentage" ? TriggerType.PERCENTAGE : TriggerType.TOKEN_PRICE,
            requestType: OpenOrderType.STOP_LOSS,
            chainId: 8453,
        };

        if (param.expiry) {
            const currentTimeInSeconds = Math.floor(Date.now() / 1000);
            const expiryInSeconds = parseInt(param.expiry, 10);
            const adjustedExpiryTime = currentTimeInSeconds + expiryInSeconds;
            openOrderInput.expiresAt = new Date(adjustedExpiryTime * 1000).toISOString();
        }

        const result = await createManualOrder(
            state.authorizationHeader as string,
            ActionType.SL,
            Source.AGENT,
            null,
            openOrderInput,
            null,
        );

        const message = result.success
            ? `Stop loss order successfully created for token ${tokenSymbol ? tokenSymbol : tokenAddress} with address ${tokenAddress}.\n` +
              `| Order ID | Trigger Type | Trigger Value | Order Type | Percentage Sold |\n` +
              `|----------|--------------|---------------|------------|--------|\n`    +
              `| ${result.metadata.orderId ? result.metadata.orderId : 'N/A'} | ${param.stop_loss_trigger === "percentage" ? "Percentage" : "Token Price"} | ${param.stop_loss_value} | ${openOrderInput?.requestType === OpenOrderType.STOP_LOSS ? "Stop Loss" : "Limit Order"} | ${param?.quantity_percentage} |\n \n`
            : `Failed to create stop loss order for token $[${tokenSymbol ? tokenSymbol : tokenAddress}|${tokenAddress}]. Error: ${result.error}`;

        callback?.({
            text: message,
            action: "STOP_LOSS",
        });

    }
}

/**
 * Validates the stop loss parameters.
 */
function validateStopLossParam(param: StopLossOrderRequest, traceId: string, moxieUserId: string) {
    if (!param.token_address || !isValidBaseAddress(param.token_address)) {
        elizaLogger.warn(
            traceId,
            `[STOP_LOSS] [${moxieUserId}] valid token_address is required to setup stop loss. Please provide a valid token_address.`
        );
        throw new Error("valid token_address is required to setup stop loss. Please provide a valid token_address.");
    }

    if (!param.stop_loss_value || !param.stop_loss_trigger) {
        elizaLogger.warn(
            traceId,
            `[STOP_LOSS] [${moxieUserId}] stop_loss_value and stop_loss_trigger are required to setup stop loss. Please provide a valid stop_loss_value and stop_loss_trigger.`
        );
        throw new Error("stop_loss_value and stop_loss_trigger are required to setup stop loss. Please provide a valid stop_loss_value and stop_loss_trigger.");
    }

    if (param.stop_loss_trigger === "absolute_price" || param.stop_loss_trigger === "price_drop") {
        if (parseFloat(param.stop_loss_value) <= 0) {
            elizaLogger.warn(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] stop_loss_value must be greater than 0. Please provide a valid stop_loss_value.`
            );
            throw new Error("stop_loss_value must be greater than 0. Please provide a valid stop_loss_value.");
        }
    } else if (param.stop_loss_trigger === "percentage") {
        if (parseFloat(param.stop_loss_value) <= 0 || parseFloat(param.stop_loss_value) > 100) {
            elizaLogger.warn(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] stop_loss_value must be greater than 0 and less than 100. Please provide a valid stop_loss_value.`
            );
            throw new Error("stop_loss_value must be greater than 0 and less than 100. Please provide a valid stop_loss_value.");
        }
    }
}

/**
 * Retrieves the sell token balance in WEI.
 */
async function getSellTokenBalanceInWEI(traceId: string, tokenAddress: string, agentWallet: MoxieClientWallet, tokenBalanceMap: Map<string, string>, moxieUserId: string): Promise<string> {
    let sellTokenBalanceInWEI = tokenBalanceMap.get(tokenAddress);
    if (!sellTokenBalanceInWEI) {
        sellTokenBalanceInWEI = await getERC20Balance(traceId, tokenAddress, agentWallet.address);
        tokenBalanceMap.set(tokenAddress, sellTokenBalanceInWEI);
    }
    if (!sellTokenBalanceInWEI) {
        elizaLogger.error(
            traceId,
            `[STOP_LOSS] [${moxieUserId}] Failed to fetch balance for token ${tokenAddress}`
        );
        throw new Error("Failed to fetch balance for token. Please try again.");
    }
    return sellTokenBalanceInWEI;
}

/**
 * Retrieves the sell token decimals.
 */
async function getSellTokenDecimals(traceId: string, tokenAddress: string, tokenDecimalMap: Map<string, number>, moxieUserId: string): Promise<number> {
    let sellTokenDecimals = tokenDecimalMap.get(tokenAddress);
    if (!sellTokenDecimals) {
        sellTokenDecimals = await getERC20Decimals(traceId, tokenAddress);
        tokenDecimalMap.set(tokenAddress, sellTokenDecimals);
    }
    if (!sellTokenDecimals) {
        elizaLogger.error(
            traceId,
            `[STOP_LOSS] [${moxieUserId}] Failed to fetch decimals for token ${tokenAddress}`
        );
        throw new Error("Failed to fetch decimals for token. Please try again.");
    }
    return sellTokenDecimals;
}

/**
 * Handles unexpected errors by logging and invoking the callback with a generic error message.
 */
async function handleUnexpectedError(traceId: string, moxieUserId: string, error: any, callback: HandlerCallback) {
    callback?.({
        text: `Something went wrong while creating stop loss rule. Please try again later.`,
        action: "STOP_LOSS",
    });
    elizaLogger.error(
        traceId,
        `[STOP_LOSS] [${moxieUserId}] error occurred while performing stop loss operation: ${JSON.stringify(error)}`
    );
}

/**
 * Multiplies a BigInt by a fractional percentage (e.g., 0.032 = 3.2%) with precision handling.
 * @param amount - The BigInt amount to apply the percentage to.
 * @param percentage - A fractional percentage (e.g., 0.032 for 3.2%)
 * @param precision - The number of decimal places to maintain (default: 6)
 * @returns The resulting BigInt after applying the percentage
 */
function applyPercentage(amount: bigint, percentage: number, precision: number = 6): bigint {
    if (percentage < 0 || percentage > 1) {
        throw new Error("Percentage must be between 0 and 1");
    }

    const scale = BigInt(10 ** precision);
    const scaledPercentage = BigInt(Math.floor(percentage * Number(scale)));

    return (amount * scaledPercentage) / scale;
}