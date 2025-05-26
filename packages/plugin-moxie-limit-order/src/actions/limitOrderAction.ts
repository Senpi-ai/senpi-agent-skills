import {
    Balance,
    CallbackTemplate,
    Context,
    FunctionResponse,
    GetQuoteResponse,
    LimitOrder,
    LimitOrderResponse,
} from "../types/types";
import {
    generateObjectDeprecated,
    composeContext,
    IAgentRuntime,
    ModelClass,
    ModelProviderName,
    stringToUuid,
    Content,
} from "@moxie-protocol/core";
import { Memory, State, HandlerCallback } from "@moxie-protocol/core";
import { ethers } from "ethers";
import { elizaLogger } from "@moxie-protocol/core";
import * as callBackTemplate from "../templates/callBackTemplate";
import * as agentLib from "@moxie-protocol/moxie-agent-lib";
import { limitOrderPromptTemplate } from "../templates/limitOrderPrompt";
import { Wallet } from "@privy-io/server-auth";
import {
    decodeTokenTransfer,
    getERC20Balance,
    getERC20Decimals,
    getNativeTokenBalance,
} from "../service/erc20";
import {
    ETH_ADDRESS,
    LIMIT_ORDER_EXPIRY_HOURS,
    MOXIE_TOKEN_DECIMALS,
    USDC,
    WETH,
    WETH_ADDRESS,
} from "../constants";
import { USDC_ADDRESS, USDC_TOKEN_DECIMALS } from "../constants";
import {
    extractTokenDetails,
    handleTransactionStatus,
    handleTransactionStatusSwap,
} from "../utils/common";
import { fetchPriceWithRetry, getPrice } from "../utils/cowUsdPrice";
import {
    BuyTokenDestination,
    OrderCreation,
    OrderKind,
    SellTokenSource,
    SigningScheme,
} from "@cowprotocol/cow-sdk";
import Decimal from "decimal.js";
import { execute0xSwap, get0xSwapQuote } from "../utils/0xApis";
import { checkAllowanceAndApproveSpendRequest } from "../utils/checkAndApproveTransaction";
import { numberToHex } from "viem";
import { size } from "viem";
import {
    swapCompletedTemplate,
    swapFailedTemplate,
    swapInProgressTemplate,
    swapTransactionFailed,
    swapTransactionVerificationTimedOut,
} from "../utils/callbackTemplates";
import { createCowLimitOrder } from "../service/cowLimitOrder";
import { getERC20TokenSymbol } from "@moxie-protocol/moxie-agent-lib";

export const limitOrderAction = {
    suppressInitialMessage: true,
    name: "LIMIT_ORDERS",
    description:
        "This action handles creating limit orders for token purchases and sales. Pay attention to the question structure - particularly any mention of price movement (either a percentage or USD value) and an action (buy/sell).",
    handler: async (
        runtime: IAgentRuntime,
        _message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        const traceId = _message.id;
        const provider = new ethers.providers.JsonRpcProvider(
            process.env.BASE_RPC_URL
        );
        elizaLogger.debug(
            traceId,
            `[limitOrderAction] started with message: ${_message.content.text}`
        );

        // create the context
        const context: Context = {
            traceId: traceId,
            runtime: runtime,
            state: state,
            provider: provider,
            callback: callback,
            message: _message,
        };

        // pre validate the required data
        try {
            await preValidateRequiredData(context);
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[limitOrderAction] [preValidateRequiredData] [ERROR] error: ${error}`
            );
            const errorTemplate = callBackTemplate.APPLICATION_ERROR(
                error.message
            );
            await callback?.(errorTemplate);
            return true;
        }

        // pick moxie user info from state
        const moxieUserInfo = state.moxieUserInfo as agentLib.MoxieUser;
        const moxieUserId = moxieUserInfo.id;
        const agentWallet = state.agentWallet as agentLib.MoxieClientWallet;

        // add moxie user id to context
        context.moxieUserId = moxieUserId;

        try {
            // process the message and extract the limit order details
            const limitOrderOptions = await processMessage(
                context,
                _message,
                runtime,
                state
            );
            if (limitOrderOptions.callBackTemplate) {
                elizaLogger.debug(
                    traceId,
                    `[limitOrderAction] [${moxieUserId}] [processMessage] limitOrderOptions: ${JSON.stringify(limitOrderOptions)}`
                );
                await callback?.({
                    text: limitOrderOptions.callBackTemplate.text,
                });
                return true;
            }

            // Validate limit order content
            const validationResult = isValidLimitOrderContent(
                context,
                limitOrderOptions.data
            );
            if (!validationResult) {
                elizaLogger.debug(
                    traceId,
                    `[limitOrderAction] [${moxieUserId}] [isValidLimitOrderContent] validationResult: ${JSON.stringify(validationResult)}`
                );
                await callback?.({
                    content: validationResult.callBackTemplate.content,
                    text: validationResult.callBackTemplate.text,
                });
                return true;
            }

            // process the limit order
            const limitOrderResult = await processLimitOrder(
                context,
                limitOrderOptions.data
            );
            if (limitOrderResult && limitOrderResult.callBackTemplate) {
                await callback?.({
                    content: limitOrderResult.callBackTemplate.content,
                    text: limitOrderResult.callBackTemplate.text,
                });
                return true;
            }
            return true;
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[limitOrderAction] [${moxieUserId}] [ERROR] error: ${error}`
            );
            const errorTemplate = callBackTemplate.APPLICATION_ERROR(
                `Error processing limit order: ${error.message}`
            );
            await callback?.({
                content: errorTemplate.content,
                text: errorTemplate.text,
            });
            return true;
        }
    },
    template: limitOrderPromptTemplate,
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true; // Consider adding actual validation logic
    },
    similes: [],
    examples: [], // Consider adding examples
};

/**
 * Pre-validates the required data for the limit order action
 * @param context - The context object containing state and traceId
 * @returns boolean
 * @throws Error if any required data is missing
 */
async function preValidateRequiredData(context: Context): Promise<boolean> {
    const { traceId, state } = context;
    elizaLogger.debug(traceId, `[preValidateRequiredData] started`);

    // Validate environment variables
    if (!process.env.BASE_RPC_URL) {
        throw new Error("BASE_RPC_URL is not set");
    }

    const chainId = Number(process.env.CHAIN_ID);
    if (!chainId) {
        process.env.CHAIN_ID = "8453";
        elizaLogger.error(
            "CHAIN_ID environment variable is not set, using default value 8453"
        );
    }

    // Validate required state objects
    if (!state.moxieUserInfo) {
        throw new Error("Moxie user info not found in state");
    }

    if (!state.agentWallet) {
        throw new Error("Agent wallet not found in state");
    }

    if (!(state.agentWallet as agentLib.MoxieClientWallet).delegated) {
        throw new Error("Delegate access not found for agent wallet");
    }

    if (!state.moxieWalletClient) {
        throw new Error("Moxie wallet client not found in state");
    }

    if (!process.env.COW_LIMIT_ORDER_APP_DATA_HASH) {
        throw new Error(
            "COW_LIMIT_ORDER_APP_DATA_HASH environment variable is not set"
        );
    }

    if (!process.env.COW_PROTOCOL_VAULT_RELAYER_ADDRESS) {
        throw new Error(
            "COW_PROTOCOL_VAULT_RELAYER_ADDRESS environment variable is not set"
        );
    }

    if (!process.env.COW_PROTOCOL_VERIFIER_CONTRACT_ADDRESS) {
        throw new Error(
            "COW_PROTOCOL_VERIFIER_CONTRACT_ADDRESS environment variable is not set"
        );
    }

    if (!process.env.LIMIT_ORDER_EXPIRY_HOURS) {
        throw new Error(
            "LIMIT_ORDER_EXPIRY_HOURS environment variable is not set"
        );
    }

    if (Number(process.env.LIMIT_ORDER_EXPIRY_HOURS) <= 0) {
        throw new Error("LIMIT_ORDER_EXPIRY_HOURS must be greater than 0");
    }

    return true;
}

/**
 * Processes the message and extracts the transfer details
 * @param context - The context of the agent
 * @param message - The message to process
 * @param runtime - The runtime environment
 * @param state - The state of the agent
 * @returns A promise that resolves to a FunctionResponse<TransactionResponse>
 */
async function processMessage(
    context: Context,
    message: Memory,
    runtime: IAgentRuntime,
    state: State
): Promise<FunctionResponse<LimitOrderResponse>> {
    elizaLogger.debug(
        context.traceId,
        `[processMessage] message called: ${JSON.stringify(message)}`
    );
    try {
        // Compose limit order context
        let limitOrderContext = composeContext({
            state,
            template: limitOrderPromptTemplate,
        });

        // Generate limit order content
        const limitOrderOptions = (await generateObjectDeprecated({
            runtime,
            context: limitOrderContext,
            modelClass: ModelClass.LARGE,
            modelConfigOptions: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                modelProvider: ModelProviderName.ANTHROPIC,
                apiKey: process.env.ANTHROPIC_API_KEY,
                modelClass: ModelClass.LARGE,
            },
        })) as LimitOrderResponse;

        elizaLogger.debug(
            context.traceId,
            `[limitOrder] [${context.moxieUserId}] limitOrderOptions: ${JSON.stringify(limitOrderOptions)}`
        );

        // Return early if confirmation required
        if (limitOrderOptions.confirmation_required) {
            elizaLogger.debug(
                context.traceId,
                `[limitOrder] [${context.moxieUserId}] confirmation_required: ${JSON.stringify(limitOrderOptions.confirmation_required)}`
            );
            return {
                callBackTemplate: {
                    text: limitOrderOptions.confirmation_message,
                    content: {
                        confirmation_required: true,
                        action: "LIMIT_ORDERS",
                        inReplyTo: message.id,
                    },
                },
            };
        }

        // Return early if there are errors
        if (limitOrderOptions.error) {
            elizaLogger.debug(
                context.traceId,
                `[limitOrder] [${context.moxieUserId}] error: ${JSON.stringify(limitOrderOptions.error)}`
            );
            return {
                callBackTemplate: {
                    text: limitOrderOptions.error.prompt_message,
                    content: {
                        action: "LIMIT_ORDERS",
                        inReplyTo: message.id,
                    },
                },
            };
        }

        return {
            data: limitOrderOptions,
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[processMessage] [ERROR] error: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                `Error processing message: ${error.message}`
            ),
        };
    }
}

/**
 * Validates the content of a limit order
 * @param context - The context of the agent
 * @param data - The data to validate
 * @returns A promise that resolves to a FunctionResponse<LimitOrderResponse>
 */
function isValidLimitOrderContent(
    context: Context,
    data: LimitOrderResponse
): FunctionResponse<LimitOrderResponse> {
    try {
        elizaLogger.debug(
            context.traceId,
            `[isValidLimitOrderContent] Validating data: ${JSON.stringify(data)}`
        );

        // Validate limit orders array exists
        if (!Array.isArray(data.limit_orders)) {
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "limit_orders must be an array"
                ),
            };
        }

        // Validate each limit order
        for (const order of data.limit_orders) {
            // Validate required string fields
            if (!order.sellToken || typeof order.sellToken !== "string") {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "sellToken is required and must be a string"
                    ),
                };
            }
            if (!order.buyToken || typeof order.buyToken !== "string") {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "buyToken is required and must be a string"
                    ),
                };
            }

            // Validate type enum
            if (!["SELL", "BUY", "SWAP"].includes(order.type)) {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "type must be SELL, BUY, or SWAP"
                    ),
                };
            }

            // Validate execution type enum
            if (!["IMMEDIATE", "FUTURE"].includes(order.execution_type)) {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "execution_type must be IMMEDIATE or FUTURE"
                    ),
                };
            }

            // Validate limitPrice object
            if (!order.limitPrice || typeof order.limitPrice !== "object") {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "limitPrice must be an object"
                    ),
                };
            }

            if (typeof order.limitPrice.value !== "number") {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "limitPrice.value must be a number"
                    ),
                };
            }

            if (
                !["PERCENTAGE", "TOKEN_PRICE"].includes(order.limitPrice.type)
            ) {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "limitPrice.type must be PERCENTAGE or TOKEN_PRICE"
                    ),
                };
            }

            // Validate numeric fields
            if (
                order.buyQuantity !== null &&
                (typeof order.buyQuantity !== "number" ||
                    order.buyQuantity <= 0)
            ) {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "buyQuantity must be null or a positive number"
                    ),
                };
            }

            // Validate sellQuantity can be null
            if (
                order.sellQuantity !== null &&
                (typeof order.sellQuantity !== "number" ||
                    order.sellQuantity <= 0)
            ) {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "sellQuantity must be null or a positive number"
                    ),
                };
            }

            // Validate balance if present
            if (order.balance !== null) {
                if (
                    typeof order.balance !== "object" ||
                    !order.balance.source_token ||
                    typeof order.balance.source_token !== "string"
                ) {
                    return {
                        callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                            "balance must be an object with source_token"
                        ),
                    };
                }

                if (!["FULL", "PERCENTAGE"].includes(order.balance.type)) {
                    return {
                        callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                            "balance type must be FULL or PERCENTAGE"
                        ),
                    };
                }

                if (
                    typeof order.balance.percentage !== "number" ||
                    order.balance.percentage < 0 ||
                    order.balance.percentage > 100
                ) {
                    return {
                        callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                            "balance percentage must be a number between 0 and 100"
                        ),
                    };
                }
            }

            // Validate value_type
            if (order.value_type && order.value_type !== "USD") {
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "value_type must be USD"
                    ),
                };
            }
        }

        return {
            data: data,
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[isValidLimitOrderContent] [ERROR] error: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                `Error validating limit order content: ${error.message}`
            ),
        };
    }
}

/**
 * Processes a limit order
 * @param context - The context of the agent
 * @param data - The data to process
 * @param agentWallet - The agent's wallet
 * @param callback - The callback to call
 * @returns A promise that resolves to a FunctionResponse<LimitOrderResponse>
 */
async function processLimitOrder(context: Context, data: LimitOrderResponse) {
    elizaLogger.debug(
        context.traceId,
        `[limitOrder] [${context.moxieUserId}] [processLimitOrder] started`
    );

    // Map to cache wallet balances for balance-based transfers to avoid duplicate queries
    const currentWalletBalanceForBalanceBasedSwaps: Map<
        string,
        bigint | undefined
    > = new Map();

    // Process each limit order sequentially
    for (const limitOrder of data.limit_orders) {
        elizaLogger.debug(
            context.traceId,
            `[limitOrder] [${context.moxieUserId}] [processLimitOrder] Processing limit order: ${JSON.stringify(limitOrder)}`
        );

        try {
            // if the execution type is future, we need to process the limit order then execute the limit order
            let result: FunctionResponse<CallbackTemplate>;
            if (limitOrder.execution_type === "FUTURE") {
                elizaLogger.debug(
                    context.traceId,
                    `[limitOrder] [${context.moxieUserId}] [processLimitOrder] Execution type is future, processing limit order then executing`
                );
                result = await processSingleLimitOrder(
                    context,
                    limitOrder,
                    currentWalletBalanceForBalanceBasedSwaps
                );
            }
            // Handle error case
            if (result.callBackTemplate) {
                elizaLogger.error(
                    context.traceId,
                    `[limitOrder] [${context.moxieUserId}] [processLimitOrder] Limit order failed: ${JSON.stringify(result.callBackTemplate)}`
                );
                return {
                    callBackTemplate: result.callBackTemplate,
                };
            }

            // Handle success case
            if (result.data) {
                elizaLogger.debug(
                    context.traceId,
                    `[limitOrder] [${context.moxieUserId}] [processLimitOrder] Limit order successful: ${JSON.stringify(result.data)}`
                );
                await context.callback({
                    content: result.data.content,
                    text: result.data.text,
                    cta: result.data.cta || undefined,
                });
            }
        } catch (error) {
            elizaLogger.error(
                context.traceId,
                `[limitOrder] [${context.moxieUserId}] [processLimitOrder] Unexpected error: ${error}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    `Error processing limit order: ${error.message}`
                ),
            };
        }
    }
}

/**
 * Processes a single transfer
 * @param context - The context of the agent
 * @param limitOrder - The limit order to process
 * @param currentWalletBalanceForBalanceBasedSwaps - The current wallet balance for balance based swaps
 * @returns A promise that resolves to a CallbackTemplate
 */
async function processSingleLimitOrder(
    context: Context,
    limitOrder: LimitOrder,
    currentWalletBalanceForBalanceBasedSwaps: Map<string, bigint | undefined>
): Promise<FunctionResponse<CallbackTemplate>> {
    elizaLogger.debug(
        context.traceId,
        `[limitOrder] [${context.moxieUserId}] [processSingleLimitOrder] limitOrder: ${JSON.stringify(limitOrder)}`
    );
    const {
        sellToken,
        buyToken,
        type,
        execution_type,
        limitPrice,
        buyQuantity,
        order_type,
        sellQuantity,
        value_type,
        balance,
    } = limitOrder;
    const agentWallet = context.state.agentWallet as agentLib.MoxieClientWallet;
    // extract the sell token address and symbol
    let sellTokenAddress: string;
    let sellTokenSymbol: string;
    let buyTokenAddress: string;
    let buyTokenSymbol: string;

    // Extract token details and check if raw tokens are Ethereum addresses
    if (ethers.utils.isAddress(sellToken)) {
        sellTokenAddress = sellToken;
        try {
            sellTokenSymbol = await getERC20TokenSymbol(sellToken);
        } catch (error) {
            elizaLogger.warn(
                context.traceId,
                `[limitOrder] [${context.moxieUserId}] Failed to fetch sell token symbol from RPC: ${error}`
            );
        }
    } else {
        const extracted = extractTokenDetails(sellToken);
        sellTokenSymbol = extracted.tokenSymbol;
        sellTokenAddress = extracted.tokenAddress;
    }

    if (ethers.utils.isAddress(buyToken)) {
        buyTokenAddress = buyToken;
        try {
            buyTokenSymbol = await getERC20TokenSymbol(buyToken);
        } catch (error) {
            elizaLogger.warn(
                context.traceId,
                `[limitOrder] [${context.moxieUserId}] Failed to fetch buy token symbol from RPC: ${error}`
            );
        }
    } else {
        const extracted = extractTokenDetails(buyToken);
        buyTokenSymbol = extracted.tokenSymbol;
        buyTokenAddress = extracted.tokenAddress;
    }

    try {
        const traceId = context.traceId;
        const moxieUserId = context.moxieUserId;
        // Validate required transfer parameters
        if (!limitOrder || !limitOrder.sellToken || !limitOrder.buyToken) {
            throw new Error("Missing required transfer parameters");
        }

        let sellTokenDecimals: number =
            sellTokenSymbol === "ETH"
                ? 18
                : await getERC20Decimals(context, sellTokenAddress);

        let buyTokenDecimals: number =
            buyTokenSymbol === "ETH"
                ? 18
                : await getERC20Decimals(context, buyTokenAddress);

        const sellTokenBalance =
            sellTokenSymbol === "ETH"
                ? await getNativeTokenBalance(agentWallet.address)
                : await getERC20Balance(sellTokenAddress, agentWallet.address);

        elizaLogger.debug(
            context.traceId,
            `[limitOrder] [${context.moxieUserId}] [processSingleLimitOrder] sellTokenBalance: ${sellTokenBalance}`
        );

        let buyTokenAmountInWEI: bigint;
        let sellTokenAmountInWEI: bigint;

        // Get current token prices in USD
        let sellTokenPriceInUSD: number;
        let buyTokenPriceInUSD: number;
        try {
            [sellTokenPriceInUSD, buyTokenPriceInUSD] = await Promise.all([
                fetchPriceWithRetry(
                    sellTokenAddress,
                    sellTokenSymbol,
                    traceId,
                    moxieUserId
                ),
                fetchPriceWithRetry(
                    buyTokenAddress,
                    buyTokenSymbol,
                    traceId,
                    moxieUserId
                ),
            ]);
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] Error fetching token prices: ${error}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    `Error fetching token prices: ${error.message}`
                ),
            };
        }
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [USD_VALUE_TYPE] sellTokenPriceInUSD: ${sellTokenPriceInUSD} and buyTokenPriceInUSD: ${buyTokenPriceInUSD}`
        );

        // Calculate target price based on limit price type
        let targetTokenPriceInUSD: number;
        if (limitPrice.type === "PERCENTAGE") {
            // For percentage, calculate target price as percentage of current price
            const percentage = limitPrice.value;
            if (type === "SELL") {
                targetTokenPriceInUSD =
                    sellTokenPriceInUSD +
                    (sellTokenPriceInUSD * percentage) / 100;
            } else if (type === "BUY") {
                targetTokenPriceInUSD =
                    buyTokenPriceInUSD +
                    (buyTokenPriceInUSD * percentage) / 100; // - since if negative percentage , it comes as -20%
            }
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [PERCENTAGE] targetPriceInUSD: ${targetTokenPriceInUSD}`
            );
        } else if (limitPrice.type === "TOKEN_PRICE") {
            // For token price, use the specified price directly
            targetTokenPriceInUSD = limitPrice.value;
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [TOKEN_PRICE] targetPriceInUSD: ${targetTokenPriceInUSD}`
            );
        }

        if (buyQuantity) {
            try {
                const amounts = await calculateBuyQuantityAmounts(
                    value_type,
                    buyQuantity,
                    targetTokenPriceInUSD,
                    sellTokenPriceInUSD,
                    buyTokenDecimals,
                    sellTokenDecimals,
                    traceId,
                    moxieUserId,
                    buyTokenPriceInUSD,
                    type
                );
                buyTokenAmountInWEI = amounts.buyTokenAmountInWEI;
                sellTokenAmountInWEI = amounts.sellTokenAmountInWEI;
            } catch (error) {
                elizaLogger.error(
                    traceId,
                    `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] Error calculating amounts: ${error}`
                );
                throw error;
            }
        } else if (sellQuantity) {
            try {
                const amounts = await calculateSellQuantityAmounts(
                    value_type,
                    sellQuantity,
                    targetTokenPriceInUSD,
                    buyTokenPriceInUSD,
                    sellTokenPriceInUSD,
                    buyTokenDecimals,
                    sellTokenDecimals,
                    traceId,
                    moxieUserId,
                    type
                );
                buyTokenAmountInWEI = amounts.buyTokenAmountInWEI;
                sellTokenAmountInWEI = amounts.sellTokenAmountInWEI;
            } catch (error) {
                elizaLogger.error(
                    traceId,
                    `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [SELL_QUANTITY] Error calculating amounts: ${error}`
                );
                throw error;
            }
        } else if (balance && balance.type) {
            try {
                const amounts = await calculateBalanceBasedAmounts(
                    traceId,
                    moxieUserId,
                    currentWalletBalanceForBalanceBasedSwaps[sellTokenAddress],
                    sellTokenAddress,
                    sellTokenSymbol,
                    sellTokenDecimals,
                    buyTokenDecimals,
                    agentWallet,
                    balance,
                    targetTokenPriceInUSD,
                    buyTokenPriceInUSD,
                    sellTokenPriceInUSD,
                    type
                );
                buyTokenAmountInWEI = amounts.buyTokenAmountInWEI;
                sellTokenAmountInWEI = amounts.sellTokenAmountInWEI;
                currentWalletBalanceForBalanceBasedSwaps[sellTokenAddress] =
                    amounts.currentWalletBalance;
            } catch (error) {
                elizaLogger.error(
                    traceId,
                    `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BALANCE_BASED] Error getting balance based quantity: ${error}`
                );
                throw error;
            }
        }

        if (sellTokenSymbol === "ETH") {
            try {
                const buyAmountInWEI = await swap(
                    context,
                    WETH_ADDRESS,
                    WETH,
                    sellTokenAddress,
                    sellTokenSymbol,
                    agentWallet.address,
                    sellTokenAmountInWEI,
                    sellTokenDecimals,
                    sellTokenDecimals // here buyTokenDecimals is same as sellTokenDecimals
                );
                elizaLogger.debug(
                    traceId,
                    `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [ETH_TO_WETH_SWAP] buyAmountInWEI: ${buyAmountInWEI.data}`
                );
                sellTokenSymbol = WETH;
                sellTokenAddress = WETH_ADDRESS;
            } catch (error) {
                elizaLogger.error(
                    traceId,
                    `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [ETH_TO_WETH_SWAP] Error swapping ETH to WETH: ${error}`
                );
                throw error;
            }
        }

        const orderCreation: OrderCreation = {
            sellToken: sellTokenAddress,
            buyToken: buyTokenAddress,
            receiver: agentWallet.address,
            sellAmount: sellTokenAmountInWEI.toString(),
            buyAmount: buyTokenAmountInWEI.toString(),
            validTo:
                Math.floor(Date.now() / 1000) +
                60 * 60 * LIMIT_ORDER_EXPIRY_HOURS,
            feeAmount: "0",
            kind: type === "SELL" ? OrderKind.SELL : OrderKind.BUY,
            partiallyFillable: true,
            sellTokenBalance: SellTokenSource.ERC20,
            buyTokenBalance: BuyTokenDestination.ERC20,
            signingScheme: SigningScheme.EIP712,
            signature: "0x", // this will filled later
            appData: process.env.COW_LIMIT_ORDER_APP_DATA_HASH,
        };
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [orderCreation] orderCreation: ${JSON.stringify(orderCreation)}`
        );

        const cowLimitOrderId = await createCowLimitOrder(
            context,
            orderCreation
        );
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [cowLimitOrder] cowLimitOrderId: ${cowLimitOrderId}`
        );

        // then insert into the database
        await (
            context.runtime.databaseAdapter as agentLib.MoxieAgentDBAdapter
        ).saveLimitOrder(cowLimitOrderId, agentWallet.address);
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [saveLimitOrder]cowLimitOrderId: ${cowLimitOrderId}`
        );

        // check if the user has alerts enabled
        const communicationPreference = await checkUserCommunicationPreferences(
            traceId,
            moxieUserId
        );
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [checkUserCommunicationPreferences] communicationPreference: ${communicationPreference}`
        );

        return {
            data: callBackTemplate.LIMIT_ORDER_SUCCESSFUL(
                cowLimitOrderId,
                communicationPreference === null
            ),
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[limitOrder] [${context.moxieUserId}] [processSingleLimitOrder] Error: ${error}`
        );
        if (error.message.toLowerCase().includes("insufficient")) {
            return {
                callBackTemplate:
                    callBackTemplate.INSUFFICIENT_BALANCE_GENERIC(
                        sellTokenSymbol
                    ),
            };
        } else if (error.message.includes("I can do that for you.")) {
            return {
                callBackTemplate: {
                    text: error.message,
                },
            };
        } else {
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    `Error processing limit order: ${error.message}`
                ),
            };
        }
    }
}

/**
 * Check the user communication preferences
 * @param userId The user ID of the person performing the swap
 * @param traceId The trace ID of the request
 * @param moxieUserId The Moxie user ID of the person performing the swap
 * @returns Promise that resolves to the user communication preferences
 */
async function checkUserCommunicationPreferences(
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
                `[limitOrder] [${moxieUserId}] Failed to fetch user preferences: ${response.statusText}`
            );
            return null;
        }

        const data = await response.json();
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] User communication preferences:`,
            data?.data?.GetUser?.communicationPreference
        );
        return data?.data?.GetUser?.communicationPreference;
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[limitOrder] [${moxieUserId}] Error checking user preferences: ${error.message}`
        );
        return null;
    }
}

/**
 * Get the current wallet balance
 * @param moxieUserId The user ID of the person performing the swap
 * @param sellToken The token to sell
 * @param agentWallet The wallet address to receive the tokens
 * @param balance The balance object
 * @returns Promise that resolves to the quantity required in WEI
 */
async function getTargetQuantityForBalanceBasedSwaps(
    traceId: string,
    currentWalletBalance: bigint | undefined,
    moxieUserId: string,
    sellTokenAddress: string,
    sellTokenSymbol: string,
    agentWallet: any,
    balance: Balance
): Promise<{ quantityInWEI: bigint; currentWalletBalance: bigint }> {
    let quantityInWEI: bigint;
    if (!currentWalletBalance) {
        currentWalletBalance = BigInt(
            sellTokenSymbol === "ETH"
                ? await getNativeTokenBalance(agentWallet.address)
                : await getERC20Balance(sellTokenAddress, agentWallet.address)
        );
    }
    elizaLogger.debug(
        traceId,
        `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [getTargetQuantityForBalanceBasedSwaps] currentWalletBalance: ${currentWalletBalance} ${sellTokenAddress}`
    );
    if (!currentWalletBalance || currentWalletBalance === 0n) {
        elizaLogger.error(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [balance] currentWalletBalance is ${currentWalletBalance}`
        );
        throw new Error(
            `Insufficient ${sellTokenSymbol} balance ${currentWalletBalance} to complete this operation`
        );
    }

    // calculate the percentage to be used for the swap
    let percentage = balance.type === "FULL" ? 100 : balance.percentage;

    // If ETH and 100%, use 99% instead
    if (sellTokenSymbol === "ETH" && percentage === 100) {
        percentage = 99;
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [balance] Using 99% instead of 100% for ETH`
        );
    }

    // Scale up by a larger factor (e.g., 1e7)
    quantityInWEI =
        (BigInt(currentWalletBalance) * BigInt(percentage * 1e7)) / BigInt(1e9);
    elizaLogger.debug(
        traceId,
        `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [balance] quantityInWEI: ${quantityInWEI}`
    );
    return { quantityInWEI, currentWalletBalance };
}

/**
 * Swaps tokens using 0x protocol
 * @param context The context object
 * @param buyTokenAddress The address of the token to buy
 * @param buyTokenSymbol The symbol of the token to buy
 * @param sellTokenAddress The address of the token to sell
 * @param sellTokenSymbol The symbol of the token to sell
 * @param agentWalletAddress The wallet address of the person performing the swap
 * @param sellAmountInWEI The amount of the token to sell in WEI
 * @param sellTokenDecimals The number of decimals of the token to sell
 * @param buyTokenDecimals The number of decimals of the token to buy
 * @returns Promise that resolves to the amount of the token to buy in WEI
 */
async function swap(
    context: Context,
    buyTokenAddress: string,
    buyTokenSymbol: string,
    sellTokenAddress: string,
    sellTokenSymbol: string,
    agentWalletAddress: string,
    sellAmountInWEI: bigint,
    sellTokenDecimals: number,
    buyTokenDecimals: number
): Promise<FunctionResponse<bigint>> {
    const traceId = context.traceId;
    const moxieUserId = context.moxieUserId;
    const provider = context.provider;
    const walletClient = context.state
        .moxieWalletClient as agentLib.MoxieWalletClient;

    elizaLogger.debug(
        traceId,
        ` [swap] called, buyTokenAddress: ${buyTokenAddress}, buyTokenSymbol: ${buyTokenSymbol}, sellTokenAddress: ${sellTokenAddress}, sellTokenSymbol: ${sellTokenSymbol}, agentWalletAddress: ${agentWalletAddress}, sellAmountInWEI: ${sellAmountInWEI}`
    );
    let buyAmountInWEI: bigint;
    let tokenBalance: bigint;
    let quote: GetQuoteResponse | null = null;
    try {
        // do balance check first
        const balance =
            sellTokenSymbol === "ETH"
                ? await provider.getBalance(agentWalletAddress)
                : await getERC20Balance(sellTokenAddress, agentWalletAddress);
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] balance: ${balance}`
        );
        tokenBalance = balance ? BigInt(balance.toString()) : BigInt(0);

        if (tokenBalance < sellAmountInWEI) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] Insufficient balance for ${sellTokenSymbol} to ${buyTokenSymbol} swap. Token balance: ${tokenBalance}, required: ${sellAmountInWEI}`
            );
            const callbackTemplate = await handleInsufficientBalance(
                traceId,
                context.state.agentWalletBalance as agentLib.Portfolio,
                moxieUserId,
                sellTokenAddress,
                sellTokenSymbol,
                sellAmountInWEI,
                tokenBalance,
                sellTokenDecimals,
                agentWalletAddress,
                context.callback,
                buyTokenAddress
            );
            throw new Error(callbackTemplate.text);
        }

        // call 0x api to get quote
        quote = await get0xSwapQuote({
            traceId: traceId,
            moxieUserId: moxieUserId,
            sellAmountBaseUnits: sellAmountInWEI.toString(),
            buyTokenAddress: buyTokenAddress,
            walletAddress: agentWalletAddress,
            sellTokenAddress: sellTokenAddress,
            buyTokenSymbol: buyTokenSymbol,
            sellTokenSymbol: sellTokenSymbol,
        });
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] get0xSwapQuote: ${JSON.stringify(quote)}`
        );

        // check is liquidity is available
        if (!quote.liquidityAvailable) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] liquidity not available for ${sellTokenSymbol} to ${buyTokenSymbol} swap`
            );
            throw new Error(
                `Liquidity not available for ${sellTokenSymbol} to ${buyTokenSymbol} swap`
            );
        }
        // for other currencies we need to check allowance and approve spending
        // check allowance and approve spending
        const issues = quote.issues;
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] issues from get0xSwapQuote: ${JSON.stringify(issues)}`
        );
        // check allowance and approve spending
        if (issues.allowance && issues.allowance != null) {
            await checkAllowanceAndApproveSpendRequest(
                traceId,
                moxieUserId,
                agentWalletAddress,
                sellTokenAddress,
                // @ts-ignore
                issues.allowance.spender,
                sellAmountInWEI,
                provider,
                walletClient,
                context.callback
            );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] checkAllowanceAndApproveSpendRequest completed`
            );
        }
        // check balance and approve spending
        if (issues.balance && issues.balance != null) {
            const balance =
                sellTokenSymbol === "ETH"
                    ? await provider.getBalance(agentWalletAddress)
                    : await getERC20Balance(
                          sellTokenAddress,
                          agentWalletAddress
                      );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] tokenBalance: ${balance}`
            );
            if (balance) {
                tokenBalance = BigInt(balance.toString());
            }
            if (tokenBalance < sellAmountInWEI) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [swap] Insufficient balance for ${sellTokenSymbol} to ${buyTokenSymbol} swap. Token balance: ${tokenBalance}, required: ${sellAmountInWEI}`
                );
                return {
                    callBackTemplate: callBackTemplate.INSUFFICIENT_BALANCE(
                        sellTokenSymbol,
                        tokenBalance.toString(),
                        sellAmountInWEI.toString()
                    ),
                };
            }
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error getting 0x quote: ${error.message}`
        );
        throw error;
    }

    // if (sellTokenSymbol != "ETH") { // skip for ETH
    // signature related
    let signResponse: agentLib.MoxieWalletSignTypedDataResponseType | undefined;
    try {
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] quote.permit2.eip712: ${JSON.stringify(quote.permit2?.eip712)}`
        );
        if (quote.permit2?.eip712) {
            const MAX_RETRIES = 3;
            let retryCount = 0;

            while (retryCount < MAX_RETRIES) {
                try {
                    signResponse = await walletClient.signTypedData(
                        quote.permit2.eip712.domain,
                        quote.permit2.eip712.types,
                        quote.permit2.eip712.message,
                        quote.permit2.eip712.primaryType
                    );
                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [swap] signResponse: ${JSON.stringify(signResponse)}`
                    );
                    break; // Exit the loop if successful
                } catch (error) {
                    retryCount++;
                    elizaLogger.warn(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [swap] Signing attempt ${retryCount} failed: ${error.message}`
                    );
                    if (retryCount >= MAX_RETRIES) {
                        elizaLogger.error(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [swap] [ERROR] Failed to sign typed data after ${MAX_RETRIES} attempts`
                        );
                        throw error; // Rethrow the error after all retries are exhausted
                    }
                    // Wait before retrying (exponential backoff)
                    await new Promise((resolve) =>
                        setTimeout(resolve, 1000 * Math.pow(2, retryCount))
                    );
                }
            }
        }

        if (signResponse && signResponse.signature && quote.transaction?.data) {
            const signatureLengthInHex = numberToHex(
                size(signResponse.signature as agentLib.MoxieHex),
                {
                    signed: false,
                    size: 32,
                }
            );
            // Append signature length and data to transaction
            quote.transaction.data = ethers.utils.hexlify(
                ethers.utils.concat([
                    quote.transaction.data,
                    signatureLengthInHex,
                    signResponse.signature,
                ])
            );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] quote.transaction.data: ${JSON.stringify(quote.transaction.data)}`
            );
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error signing typed data: ${error}`
        );
        throw error;
    }
    // }

    // execute 0x swap
    let tx: agentLib.MoxieWalletSendTransactionResponseType | null = null;
    try {
        tx = await execute0xSwap({
            context: context,
            quote: quote,
            agentWalletAddress: agentWalletAddress,
            walletClient: walletClient,
        });
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] 0x tx: ${JSON.stringify(tx)}`
        );
    } catch (error) {
        elizaLogger.error(
            traceId,
            "[tokenSwap] [${moxieUserId}] [swap] Error executing 0x swap:",
            { error }
        );
        throw error;
    }

    await context.callback(
        swapInProgressTemplate(
            sellTokenSymbol,
            sellTokenAddress,
            buyTokenSymbol,
            buyTokenAddress,
            tx.hash
        )
    );

    // wait for tx to be mined
    let txnReceipt: ethers.providers.TransactionReceipt | null;
    try {
        txnReceipt = await handleTransactionStatusSwap(
            traceId,
            moxieUserId,
            provider,
            tx.hash
        );
        if (!txnReceipt) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] txnReceipt is null`
            );
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error handling transaction status: ${JSON.stringify(error)}`
        );
        await context.callback(swapTransactionVerificationTimedOut(tx.hash));
        throw error;
    }

    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [swap] 0x swap txnReceipt: ${JSON.stringify(txnReceipt)}`
    );
    if (txnReceipt && txnReceipt.status == 1) {
        if (
            buyTokenAddress !== ETH_ADDRESS &&
            buyTokenAddress !== WETH_ADDRESS
        ) {
            // decode the txn receipt to get the moxie purchased
            const transferDetails = await decodeTokenTransfer(
                moxieUserId,
                txnReceipt,
                buyTokenAddress,
                agentWalletAddress
            );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] 0x swap decodeTokenTransfer: ${JSON.stringify(transferDetails)}`
            );
            if (transferDetails) {
                buyAmountInWEI = BigInt(transferDetails.amount);
                elizaLogger.debug(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [swap] buyAmountInWEI: ${buyAmountInWEI}`
                );
            } else {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [swap] Error decoding token transfer`
                );
                throw new Error(`Error decoding token transfer`);
            }
        }

        await context.callback(
            swapCompletedTemplate(
                sellTokenSymbol,
                sellTokenAddress,
                buyTokenSymbol,
                buyTokenAddress,
                buyAmountInWEI,
                buyTokenDecimals
            )
        );
        return {
            data: buyAmountInWEI,
        };
    } else {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] 0x swap failed: ${tx.hash} `
        );
        await context.callback(swapTransactionFailed(tx.hash));
    }
}

/**
 * Handle insufficient balance
 * @param currentWalletBalance - The current wallet balance
 * @param moxieUserId - The user ID of the person performing the swap
 * @param sellTokenAddress - The address of the sell token
 * @param sellTokenSymbol - The symbol of the sell token
 * @param sellAmountInWEI - The amount of the sell token in WEI
 * @param tokenBalance - The balance of the sell token
 * @param sellTokenDecimals - The decimals of the sell token
 * @param agentWalletAddress - The address of the agent wallet
 * @param callback - The callback function to receive status updates
 */
async function handleInsufficientBalance(
    traceId: string,
    currentWalletBalance: agentLib.Portfolio,
    moxieUserId: string,
    sellTokenAddress: string,
    sellTokenSymbol: string,
    sellAmountInWEI: bigint,
    tokenBalance: bigint,
    sellTokenDecimals: number,
    agentWalletAddress: string,
    callback: HandlerCallback,
    buyTokenAddress: string
): Promise<CallbackTemplate> {
    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [handleInsufficientBalance] [currentWalletBalance]: ${JSON.stringify(currentWalletBalance)}`
    );
    // Get indicative price of buy token in USD
    let indicativePriceOfBuyTokenInUSD: string;
    if (sellTokenAddress !== USDC_ADDRESS) {
        // use codex to get the price
        const price = await getPrice(
            traceId,
            moxieUserId,
            sellAmountInWEI.toString(),
            sellTokenAddress,
            sellTokenDecimals,
            sellTokenSymbol,
            USDC_ADDRESS,
            USDC_TOKEN_DECIMALS,
            USDC
        );
        indicativePriceOfBuyTokenInUSD = ethers.utils.formatUnits(
            price,
            USDC_TOKEN_DECIMALS
        );
    } else {
        indicativePriceOfBuyTokenInUSD = ethers.utils.formatUnits(
            sellAmountInWEI,
            sellTokenDecimals
        );
    }
    const otherTokensWithSufficientBalance =
        currentWalletBalance.tokenBalances.filter(
            (token) =>
                (!buyTokenAddress ||
                    token.token.baseToken.address.toLowerCase() !==
                        buyTokenAddress.toLowerCase()) &&
                Decimal(token.token.balanceUSD).gt(
                    Decimal(indicativePriceOfBuyTokenInUSD.toString())
                )
        );
    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [handleInsufficientBalance] [otherTokensWithSufficientBalance]: ${JSON.stringify(otherTokensWithSufficientBalance)}`
    );

    // extract the symbols from otherTokensWithSufficientBalance
    const otherTokenSymbols = otherTokensWithSufficientBalance
        .sort((a, b) =>
            Decimal(b.token.balanceUSD).minus(a.token.balanceUSD).toNumber()
        )
        .slice(0, 3)
        .map((token) => token.token.baseToken.symbol);
    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [handleInsufficientBalance] [otherTokenSymbols]: ${JSON.stringify(otherTokenSymbols)}`
    );

    // extract a map with symbol as key and token as value
    const otherTokenSymbolsMap = otherTokensWithSufficientBalance.reduce(
        (acc, token) => {
            acc[token.token.baseToken.symbol] = token;
            return acc;
        },
        {}
    );
    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [handleInsufficientBalance] [otherTokenSymbolsMap]: ${JSON.stringify(otherTokenSymbolsMap)}`
    );

    return {
        text:
            otherTokensWithSufficientBalance.length === 0
                ? `\nInsufficient ${sellTokenSymbol} balance to complete this transaction. \n Current balance: ${ethers.utils.formatUnits(tokenBalance, sellTokenDecimals)} ${sellTokenSymbol} \n Required balance: ${ethers.utils.formatUnits(sellAmountInWEI, sellTokenDecimals)} ${sellTokenSymbol} \n\nPlease add more ${sellTokenSymbol} funds to your agent wallet to complete this transaction.`
                : `\nI can do that for you. Would you like me to use your ${otherTokenSymbols.slice(0, -1).join(", ")}${otherTokenSymbols.length > 1 ? " or " : ""}${otherTokenSymbols[otherTokenSymbols.length - 1]} ?
                \n<!--
                \n${otherTokenSymbols
                    .map((symbol) => {
                        const token = otherTokenSymbolsMap[symbol];
                        return `• ${symbol} (${
                            symbol === "ETH"
                                ? ETH_ADDRESS
                                : symbol === "USDC"
                                  ? USDC_ADDRESS
                                  : token.token.baseToken.address
                        }): ${token.token.balance} (${token.token.balanceUSD} USD)`;
                    })
                    .join("\n")}
                \n-->
            `,
        content: {
            type: "user_message", // This is a message that should be shown directly to the user
        },
    };
}

const calculateBuyQuantityAmounts = async (
    value_type: string,
    buyQuantity: number,
    limitPriceInUSD: number,
    sellTokenPriceInUSD: number,
    buyTokenDecimals: number,
    sellTokenDecimals: number,
    traceId: string,
    moxieUserId: string,
    buyTokenPriceInUSD: number,
    type: string
): Promise<{ buyTokenAmountInWEI: bigint; sellTokenAmountInWEI: bigint }> => {
    elizaLogger.debug(
        traceId,
        `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [type]: ${type}`
    );
    if (value_type && value_type == "USD") {
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [VALUE_TYPE]: ${value_type}`
        );
        try {
            let buyAmount: string;
            let sellAmount: string;
            if (type === "SELL") {
                // this is for usd based direct sell case where user is selling in terms of buy quantity
                // sell $KTA when price increase by 10% and get me $10 worth of moxie
                buyAmount = new Decimal(buyQuantity)
                    .div(buyTokenPriceInUSD)
                    .toFixed(buyTokenDecimals);
                sellAmount = new Decimal(buyQuantity)
                    .div(limitPriceInUSD)
                    .toFixed(sellTokenDecimals);
            } else if (type === "BUY") {
                // this is for usd based direct buy case where user is buying in terms of buy quantity
                // buy $10 worth of $KTA when price drops by 10%
                buyAmount = new Decimal(buyQuantity)
                    .div(limitPriceInUSD)
                    .toFixed(buyTokenDecimals);
                sellAmount = new Decimal(buyQuantity)
                    .div(sellTokenPriceInUSD)
                    .toFixed(sellTokenDecimals);
            }

            // Convert to WEI
            const buyTokenAmountInWEI = BigInt(
                ethers.utils.parseUnits(buyAmount, buyTokenDecimals).toString()
            );
            const sellTokenAmountInWEI = BigInt(
                ethers.utils
                    .parseUnits(sellAmount, sellTokenDecimals)
                    .toString()
            );

            // Log results
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [USD_VALUE_TYPE] buyAmount: ${buyAmount}, buyAmountInWEI: ${buyTokenAmountInWEI}`
            );
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [USD_VALUE_TYPE] sellAmount: ${sellAmount}, sellAmountInWEI: ${sellTokenAmountInWEI}`
            );

            return { buyTokenAmountInWEI, sellTokenAmountInWEI };
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [USD_VALUE_TYPE] Error getting price: ${error}`
            );
            throw error;
        }
    } else {
        // this is for direct case where user is buying in terms of buy quantity
        try {
            let buyAmount: string;
            let sellAmount: string;
            if (type === "SELL") {
                // sell $[KTA|0x12323423] when price increase by 10% and get me 1000 moxie
                buyAmount = new Decimal(buyQuantity).toFixed(buyTokenDecimals);
                sellAmount = new Decimal(buyQuantity)
                    .mul(buyTokenPriceInUSD)
                    .div(limitPriceInUSD)
                    .toFixed(sellTokenDecimals);
            } else if (type === "BUY") {
                // buy 1000 $[KTA|0x12323423] when price drops by 10%
                buyAmount = new Decimal(buyQuantity).toFixed(buyTokenDecimals);
                sellAmount = new Decimal(buyAmount)
                    .mul(limitPriceInUSD)
                    .div(sellTokenPriceInUSD)
                    .toFixed(sellTokenDecimals);
            }

            // Convert to WEI
            const buyTokenAmountInWEI = BigInt(
                ethers.utils
                    .parseUnits(buyAmount.toString(), buyTokenDecimals)
                    .toString()
            );
            const sellTokenAmountInWEI = BigInt(
                ethers.utils
                    .parseUnits(sellAmount, sellTokenDecimals)
                    .toString()
            );

            // Log results
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [DIRECT_VALUE_TYPE] buyAmount: ${buyAmount}, buyAmountInWEI: ${buyTokenAmountInWEI}`
            );
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [DIRECT_VALUE_TYPE] sellAmount: ${sellAmount}, sellAmountInWEI: ${sellTokenAmountInWEI}`
            );

            return { buyTokenAmountInWEI, sellTokenAmountInWEI };
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BUY_QUANTITY] [DIRECT_VALUE_TYPE] Error getting price: ${error}`
            );
            throw error;
        }
    }
};

const calculateSellQuantityAmounts = async (
    value_type: string,
    sellQuantity: number,
    limitPriceInUSD: number,
    buyTokenPriceInUSD: number,
    sellTokenPriceInUSD: number,
    buyTokenDecimals: number,
    sellTokenDecimals: number,
    traceId: string,
    moxieUserId: string,
    type: string
): Promise<{ buyTokenAmountInWEI: bigint; sellTokenAmountInWEI: bigint }> => {
    elizaLogger.debug(
        traceId,
        `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] started with type: ${type}`
    );
    if (value_type && value_type == "USD") {
        elizaLogger.debug(
            traceId,
            `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [SELL_QUANTITY] [VALUE_TYPE]: ${value_type}`
        );
        try {
            // Calculate token amounts based on USD values
            let buyAmount: string;
            let sellAmount: string;
            if (type === "SELL") {
                // this is for usd based direct sell case where user is selling in terms of sell quantity
                // example: sell $10 $KTA when price rises by 20%
                buyAmount = new Decimal(sellQuantity)
                    .div(buyTokenPriceInUSD)
                    .toFixed(buyTokenDecimals);
                sellAmount = new Decimal(sellQuantity)
                    .div(limitPriceInUSD)
                    .toFixed(sellTokenDecimals);
            } else if (type === "BUY") {
                // this is for usd based direct buy case where user is buying in terms of sell quantity
                // example: buy $KTA when price drops by 20% using 100$ $moxie
                sellAmount = new Decimal(sellQuantity)
                    .div(sellTokenPriceInUSD)
                    .toFixed(sellTokenDecimals);
                buyAmount = new Decimal(sellAmount)
                    .mul(sellTokenPriceInUSD)
                    .div(limitPriceInUSD)
                    .toFixed(buyTokenDecimals);
            }

            // Convert to WEI
            const buyTokenAmountInWEI = BigInt(
                ethers.utils.parseUnits(buyAmount, buyTokenDecimals).toString()
            );
            const sellTokenAmountInWEI = BigInt(
                ethers.utils
                    .parseUnits(sellAmount, sellTokenDecimals)
                    .toString()
            );

            // Log results
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [SELL_QUANTITY] [USD_VALUE_TYPE] buyAmount: ${buyAmount}, buyAmountInWEI: ${buyTokenAmountInWEI}`
            );
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [SELL_QUANTITY] [USD_VALUE_TYPE] sellAmount: ${sellAmount}, sellAmountInWEI: ${sellTokenAmountInWEI}`
            );

            return { buyTokenAmountInWEI, sellTokenAmountInWEI };
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [SELL_QUANTITY] [USD_VALUE_TYPE] Error getting price: ${error}`
            );
            throw error;
        }
    } else {
        // this is for direct case where user is selling in terms of sell quantity
        try {
            let buyAmount: string;
            let sellAmount: string;
            if (type === "SELL") {
                // this is for direct sell case where user is selling in terms of sell quantity
                // example: sell 10 $KTA when price rises by 20%
                sellAmount = new Decimal(sellQuantity).toFixed(
                    sellTokenDecimals
                );
                buyAmount = new Decimal(sellQuantity)
                    .mul(limitPriceInUSD)
                    .div(buyTokenPriceInUSD)
                    .toFixed(buyTokenDecimals);
            } else if (type === "BUY") {
                // this is for direct buy case where user is buying in terms of sell quantity
                // example: buy $KTA when price drops by 20% using 100 $moxie
                sellAmount = new Decimal(sellQuantity).toFixed(
                    sellTokenDecimals
                );
                buyAmount = new Decimal(sellQuantity)
                    .mul(sellTokenPriceInUSD)
                    .div(limitPriceInUSD)
                    .toFixed(buyTokenDecimals);
            }

            // Convert to WEI
            const buyTokenAmountInWEI = BigInt(
                ethers.utils
                    .parseUnits(buyAmount.toString(), buyTokenDecimals)
                    .toString()
            );
            const sellTokenAmountInWEI = BigInt(
                ethers.utils
                    .parseUnits(sellAmount.toString(), sellTokenDecimals)
                    .toString()
            );

            // Log results
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [SELL_QUANTITY] [DIRECT_VALUE_TYPE] buyAmount: ${buyAmount}, buyAmountInWEI: ${buyTokenAmountInWEI}`
            );
            elizaLogger.debug(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [SELL_QUANTITY] [DIRECT_VALUE_TYPE] sellAmount: ${sellAmount}, sellAmountInWEI: ${sellTokenAmountInWEI}`
            );

            return { buyTokenAmountInWEI, sellTokenAmountInWEI };
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [SELL_QUANTITY] [DIRECT_VALUE_TYPE] Error getting price: ${error}`
            );
            throw error;
        }
    }
};

const calculateBalanceBasedAmounts = async (
    traceId: string,
    moxieUserId: string,
    currentBalance: bigint,
    sellTokenAddress: string,
    sellTokenSymbol: string,
    sellTokenDecimals: number,
    buyTokenDecimals: number,
    agentWallet: any,
    balance: any,
    limitPriceInUSD: number,
    buyTokenPriceInUSD: number,
    sellTokenPriceInUSD: number,
    type: string
): Promise<{
    buyTokenAmountInWEI: bigint;
    sellTokenAmountInWEI: bigint;
    currentWalletBalance: bigint;
}> => {
    elizaLogger.debug(
        traceId,
        `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BALANCE_BASED] [type]: ${type}`
    );
    const result = await getTargetQuantityForBalanceBasedSwaps(
        traceId,
        currentBalance,
        moxieUserId,
        sellTokenAddress,
        sellTokenSymbol,
        agentWallet,
        balance
    );

    const sellQuantity = ethers.utils.formatUnits(
        result.quantityInWEI,
        sellTokenDecimals
    );
    elizaLogger.debug(
        traceId,
        `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BALANCE_BASED] sellQuantity: ${sellQuantity}`
    );

    let sellAmount: string;
    let buyAmount: string;
    if (type === "SELL") {
        // sell all of my $KTA when the price rises by 20%
        sellAmount = new Decimal(sellQuantity).toFixed(sellTokenDecimals);
        buyAmount = new Decimal(sellQuantity)
            .mul(limitPriceInUSD)
            .div(buyTokenPriceInUSD)
            .toFixed(buyTokenDecimals);
    } else if (type === "BUY") {
        // buy $KTA when price drops by 20% using 10% of my $usdc balance
        sellAmount = new Decimal(sellQuantity).toFixed(sellTokenDecimals);
        buyAmount = new Decimal(sellQuantity)
            .mul(sellTokenPriceInUSD)
            .div(limitPriceInUSD)
            .toFixed(buyTokenDecimals);
    }

    // Convert to WEI
    const buyTokenAmountInWEI = BigInt(
        ethers.utils
            .parseUnits(buyAmount.toString(), buyTokenDecimals)
            .toString()
    );
    const sellTokenAmountInWEI = BigInt(
        ethers.utils
            .parseUnits(sellAmount.toString(), sellTokenDecimals)
            .toString()
    );

    // Log results
    elizaLogger.debug(
        traceId,
        `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BALANCE_BASED] buyAmount: ${buyAmount}, buyAmountInWEI: ${buyTokenAmountInWEI}`
    );
    elizaLogger.debug(
        traceId,
        `[limitOrder] [${moxieUserId}] [processSingleLimitOrder] [BALANCE_BASED] sellAmount: ${sellAmount}, sellAmountInWEI: ${sellTokenAmountInWEI}`
    );

    return {
        buyTokenAmountInWEI,
        sellTokenAmountInWEI,
        currentWalletBalance: result.currentWalletBalance,
    };
};
