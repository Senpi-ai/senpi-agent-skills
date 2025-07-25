import {
    composeContext,
    elizaLogger,
    generateObjectDeprecated,
    HandlerCallback,
    ModelClass,
    ModelProviderName,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@moxie-protocol/core";
import {
    MoxieClientWallet,
    MoxieUser,
    MoxieWalletClient,
    getERC20TokenSymbol,
} from "@moxie-protocol/moxie-agent-lib";
import { senpiOrdersTemplate } from "../templates/senpiOrdersTemplate";
import {
    getERC20Balance,
    getERC20Decimals,
    getNativeTokenBalance,
    extractTokenDetails,
    createManualOrder,
} from "../utils/common";
import { ethers } from "ethers";
import { senpiOrdersExamples } from "./examples";
import {
    ETH_ADDRESS,
    BASE_NETWORK_ID,
    USD,
    ETH,
    USDC,
    USDC_ADDRESS,
    USDC_TOKEN_DECIMALS,
} from "../utils/constants";
import {
    agentWalletNotFound,
    delegateAccessNotFound,
    senpiWalletClientNotFound,
    insufficientEthBalanceTemplate,
    swapOperationFailedTemplate,
} from "../utils/callbackTemplates";
import Decimal from "decimal.js";
import { getPrice, getUSDPrice } from "../utils/codexApis";
import {
    ActionType,
    OpenOrderInput,
    OrderTriggerType,
    OrderType,
    RequestType,
    SenpiOrdersResponse,
    Source,
    SwapInput,
    TriggerType,
    BalanceType,
    LimitOrderType,
    ActiveViewType
} from "../types";



export const senpiOrdersAction = {
    suppressInitialMessage: true,
    name: "SENPI_ORDERS",
    examples: senpiOrdersExamples,
    description:
        "This action handles all order-related operations for Senpi, including swapping (buying or selling) ERC20 tokens, setting up limit orders for profit-taking, and configuring stop-loss orders for minimising loss. It does not support copy trading or automated trading strategies.",
    handler: async (
        runtime: IAgentRuntime,
        _message: Memory,
        state: State,
        _options: any,
        callback?: any
    ) => {
        // pick moxie user info from state
        const moxieUserInfo = state.moxieUserInfo as MoxieUser;
        const moxieUserId = moxieUserInfo.id;
        const traceId = _message.id;

        const tokenAddressToSymbol: Map<string, string> = new Map();
        const tokenAddressToDecimals: Map<string, number> = new Map();
        const walletAddressToTokenAddressToBalance: Map<string, bigint> = new Map();
        const tokenAddressToPrice: Map<string, number> = new Map();


        try {
            elizaLogger.debug(
                traceId,
                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Starting senpiOrders handler with user message: ${JSON.stringify(_message, (key, value) => (key === "embedding" ? undefined : value))}`
            );

            const agentWallet = state.agentWallet as MoxieClientWallet;
            if (!agentWallet || !agentWallet.delegated) {
                await handleAgentWalletErrors(agentWallet, traceId, moxieUserId, callback);
                return true;
            }

            const walletClient = state.moxieWalletClient as MoxieWalletClient;
            if (!walletClient) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] walletClient not found`
                );
                await callback?.(senpiWalletClientNotFound);
                return true;
            }

            // Compose senpi orders context
            const senpiOrdersContext = composeContext({
                state,
                template: senpiOrdersTemplate,
            });

            const {senpiOrders, error} = await generateSenpiOrders(runtime, senpiOrdersContext, traceId, moxieUserId, callback, _message.id);
            if (error) return true;

            const action = senpiOrders.action;
            elizaLogger.debug(
                traceId,
                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] action: ${action}`
            );

            const groupedTransactions = groupTransactionsByTokenAddress(senpiOrders.transactions, traceId, moxieUserId);
            const currentWalletBalanceForBalanceBasedSwaps: Map<string, bigint | undefined> = new Map();

            for (const [tokenAddress, transactions] of groupedTransactions.entries()) {
                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Processing transactions for tokenAddress: ${tokenAddress}`
                );

                const { extractedTokenSymbol, extractedTokenAddress, extractedTokenDecimals } = await extractTokenDetailsAndDecimalsWithCache(
                    tokenAddress,
                    traceId,
                    moxieUserId,
                    tokenAddressToSymbol,
                    tokenAddressToDecimals
                );

                await callback?.({
                    text: `Preparing your order for $[${extractedTokenSymbol}|${extractedTokenAddress}]\n`,
                    content: {
                        action: "SENPI_ORDERS",
                        inReplyTo: traceId,
                    },
                });

                let swapInput: SwapInput | undefined;
                let stopLossInput: OpenOrderInput[] = [];
                let limitOrderInput: OpenOrderInput[] = [];
                let swapOrderType: OrderType | undefined;

                for (const transaction of transactions) {
                    // Process each transaction
                    elizaLogger.debug(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Processing transaction: ${JSON.stringify(transaction)}`
                    );

                    const { swapInput: newSwapInput, stopLossInput: newStopLossInput, limitOrderInput: newLimitOrderInput } = await processTransaction(
                        transaction,
                        traceId,
                        moxieUserId,
                        tokenAddressToSymbol,
                        tokenAddressToDecimals,
                        walletAddressToTokenAddressToBalance,
                        tokenAddressToPrice,
                        currentWalletBalanceForBalanceBasedSwaps,
                        agentWallet,
                        action,
                        callback,
                        traceId,
                        state,
                    );

                    swapInput = newSwapInput || swapInput;
                    if (swapInput) {
                        if (transaction.orderType == OrderType.BUY) {
                            swapOrderType = OrderType.BUY;
                        } else if (transaction.orderType == OrderType.SELL) {
                            swapOrderType = OrderType.SELL;
                        }
                    }
                    stopLossInput = stopLossInput.concat(newStopLossInput);
                    limitOrderInput = limitOrderInput.concat(newLimitOrderInput);
                }

                if (swapInput || stopLossInput.length > 0 || limitOrderInput.length > 0) {

                    const result = await createManualOrder(state.authorizationHeader as string, action, Source.AGENT, swapInput, stopLossInput, limitOrderInput);

                    // generates response for the user
                    await handleOrderCreationResult(
                        result,
                        tokenAddress,
                        traceId,
                        moxieUserId,
                        swapInput,
                        limitOrderInput,
                        swapOrderType,
                        callback
                    );
                }
                await clearCache(runtime, moxieUserId, traceId);
            }

            return true;

        } catch (error) {
            await handleError(error, traceId, moxieUserId, callback);
            return true;
        }
    },
    template: senpiOrdersTemplate,
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true;
    },
    similes: [
        "SENPI_ORDERS",
        "TRADE_TOKENS",
        "SWAP_TOKENS",
        "BUY_TOKENS",
        "SELL_TOKENS",
        "PURCHASE_TOKENS",
        "STOP_LOSS",
        "LIMIT_ORDER",
        "SWAP_SL",
        "SWAP_SL_LO",
        "LO",
        "SL",
        "SL_LO",
    ],
};

async function processTransaction(
    transaction: any,
    traceId: string,
    moxieUserId: string,
    tokenAddressToSymbol: Map<string, string>,
    tokenAddressToDecimals: Map<string, number>,
    walletAddressToTokenAddressToBalance: Map<string, bigint>,
    tokenAddressToPrice: Map<string, number>,
    currentWalletBalanceForBalanceBasedSwaps: Map<string, bigint | undefined>,
    agentWallet: MoxieClientWallet,
    action: ActionType,
    callback?: any,
    messageId?: string,
    state?: State,
): Promise<{ swapInput: SwapInput | undefined, stopLossInput: OpenOrderInput[], limitOrderInput: OpenOrderInput[], error: boolean }> {
    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [processTransaction] Processing transaction: ${JSON.stringify(transaction)}`
    );

    let swapInput: SwapInput | undefined;
    let error = false;
    let stopLossInput: OpenOrderInput[] = [];
    let limitOrderInput: OpenOrderInput[] = [];

    let { sellToken, buyToken, orderType, triggerPrice, balance } = transaction;

    if (triggerPrice) {
        triggerPrice = Math.abs(triggerPrice);
    }

    if (balance && balance.value) {
        balance.value = Math.abs(balance.value);
    }

    const { extractedTokenSymbol: extractedSellTokenSymbol,
        extractedTokenAddress: extractedSellTokenAddress,
        extractedTokenDecimals: extractedSellTokenDecimals }
        = await extractTokenDetailsAndDecimalsWithCache(
        sellToken,
        traceId,
        moxieUserId,
        tokenAddressToSymbol,
        tokenAddressToDecimals
    );

    const {
        extractedTokenSymbol: extractedBuyTokenSymbol,
        extractedTokenAddress: extractedBuyTokenAddress,
        extractedTokenDecimals: extractedBuyTokenDecimals,
    } = await extractTokenDetailsAndDecimalsWithCache(
        buyToken,
        traceId,
        moxieUserId,
        tokenAddressToSymbol,
        tokenAddressToDecimals
    );

    if (orderType == OrderType.BUY || orderType == OrderType.SELL) {
        const result = await handleSwapOrder(
            transaction,
            extractedSellTokenSymbol,
            extractedSellTokenAddress,
            extractedSellTokenDecimals,
            extractedBuyTokenSymbol,
            extractedBuyTokenAddress,
            extractedBuyTokenDecimals,
            currentWalletBalanceForBalanceBasedSwaps,
            traceId,
            moxieUserId,
            agentWallet,
            callback,
            state
        );
        swapInput = result.swapInput;
        error = result.error;

        if (error) {
            return {swapInput: undefined, stopLossInput: [], limitOrderInput: [], error};
        }

    } else if (orderType == OrderType.STOP_LOSS || orderType == OrderType.LIMIT_ORDER_SELL || orderType == OrderType.LIMIT_ORDER_BUY) {
        const result = await handleSellOrder(
            transaction,
            extractedSellTokenSymbol,
            extractedSellTokenAddress,
            extractedSellTokenDecimals,
            extractedBuyTokenSymbol,
            extractedBuyTokenAddress,
            extractedBuyTokenDecimals,
            traceId,
            moxieUserId,
            agentWallet,
            tokenAddressToPrice,
            walletAddressToTokenAddressToBalance,
            action,
            callback,
        );
        stopLossInput = result.stopLossInput;
        limitOrderInput = result.limitOrderInput;
        error = result.error;

        if (error) {
            return {swapInput: undefined, stopLossInput: [], limitOrderInput: [], error};
        }
    } else {
        elizaLogger.warn(
            traceId,
            `[senpiOrders] [${moxieUserId}] [processTransaction] Unknown order type: ${transaction.orderType}`
        );

        await callback?.({
            text: "⚠️ Hmm… I couldn't quite catch that. Mind trying again?\n",
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: messageId,
            },
        });

        error = true;

        return {swapInput: undefined, stopLossInput: [], limitOrderInput: [], error};
    }

    return { swapInput, stopLossInput, limitOrderInput, error };
}

async function handleAgentWalletErrors(agentWallet: MoxieClientWallet | undefined, traceId: string, moxieUserId: string, callback?: any) {
    if (!agentWallet) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleAgentWalletErrors] agentWallet not found`
        );
        await callback?.(agentWalletNotFound);
    } else if (!agentWallet.delegated) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleAgentWalletErrors] agentWallet is not delegated`
        );
        await callback?.(delegateAccessNotFound);
    }
}

async function generateSenpiOrders(runtime: IAgentRuntime, context: any, traceId: string, moxieUserId: string, callback?: any, messageId?: string): Promise<{senpiOrders: SenpiOrdersResponse | null, error: boolean}> {

    let error = false;

    const senpiOrders = (await generateObjectDeprecated({
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
    })) as SenpiOrdersResponse;

    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [generateSenpiOrders] swapOptions: ${JSON.stringify(senpiOrders)}`
    );

    if (senpiOrders.error) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [generateSenpiOrders] senpiOrders has error: ${JSON.stringify(senpiOrders)}`
        );
        await callback?.({
            text: senpiOrders.error?.prompt_message || "⚠️ Hmm, something didn’t go through. Mind giving it another shot?\n",
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: messageId,
            },
        });
        return {senpiOrders: null, error: true};
    }

    if (!validateSenpiOrders(traceId, moxieUserId, senpiOrders, callback)) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [generateSenpiOrders] senpiOrders is not valid: ${JSON.stringify(senpiOrders)}`
        );
        return {senpiOrders: null, error: true};
    }

    return {senpiOrders, error: error};
}

async function validateSenpiOrders(
    traceId: string,
    moxieUserId: string,
    content: SenpiOrdersResponse,
    callback: HandlerCallback
): Promise<boolean> {
    // Validate basic content structure
    if (
        !content ||
        !content.transactions ||
        content.transactions.length === 0
    ) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [validateSenpiOrders] Invalid content structure: ${JSON.stringify(content)}`
        );
        await callback?.({
            text: "⚠️ No orders were detected in your request. Please specify the swap, limit order, or stop loss orders you wish to create.",
            content: {
                error: "INVALID_CONTENT",
                details:
                    "An error occurred while processing your request. Please try again.",
            },
        });
        return false;
    }

    // Validate each transaction
    for (const transaction of content.transactions) {
        // Check required fields
        const missingFields = [];
        if (!transaction.sellToken) missingFields.push("sellToken");
        if (!transaction.buyToken) missingFields.push("buyToken");
        if (!transaction.orderType) missingFields.push("orderType");

        if (transaction.orderType === OrderType.STOP_LOSS || transaction.orderType === OrderType.LIMIT_ORDER_BUY || transaction.orderType === OrderType.LIMIT_ORDER_SELL) {
            if (!transaction.triggerType) missingFields.push("triggerType");
            if (!transaction.triggerPrice) missingFields.push("triggerPrice");
            if (!transaction.balance.type) missingFields.push("balance.type");
            if (!transaction.balance.value) missingFields.push("balance.value");
        }

        if (missingFields.length > 0) {
            elizaLogger.error(
                traceId,
                `[senpiOrders] [${moxieUserId}] [validateSenpiOrders] Missing required fields in transaction: ${JSON.stringify(transaction)}`
            );
            await callback?.({
                text: "⚠️ Your Order request is missing some required details. Please take a quick look and try again!\n",
                content: {
                    error: "MISSING_FIELDS",
                    details: `Missing fields: ${missingFields.join(", ")}`,
                },
            });
            return false;
        }

        // Validate quantities are positive
        if (
            (transaction.sellQuantity && transaction.sellQuantity <= 0) ||
            (transaction.buyQuantity && transaction.buyQuantity <= 0)
        ) {
            elizaLogger.error(
                traceId,
                `[senpiOrders] [${moxieUserId}] [validateSenpiOrders] Invalid quantity: sellQuantity=${transaction.sellQuantity}, buyQuantity=${transaction.buyQuantity}`
            );
            await callback?.({
                text: "⚠️ You'll need to enter an amount greater than 0. Please update your prompt and retry\n",
                content: {
                    error: "INVALID_QUANTITY",
                    details: "Quantities must be positive",
                },
            });
            return false;
        }

        // Validate balance fields if present
        if (transaction.balance && transaction.balance.type) {
            if (
                !transaction.balance.sourceToken ||
                !transaction.balance.type ||
                (transaction.balance.type === BalanceType.PERCENTAGE &&
                    (transaction.balance.value <= 0 ||
                        (transaction.balance.value > 100 && transaction.orderType !== OrderType.LIMIT_ORDER_SELL)))
            ) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [validateSenpiOrders] Invalid balance configuration: ${JSON.stringify(transaction.balance)}`
                );
                await callback?.({
                    text: "⚠️ Those percentage settings seem a bit off. Could you take another look and try again?\n",
                    content: {
                        error: "INVALID_BALANCE",
                        details:
                            "An error occurred while processing your request. Please try again.",
                    },
                });
                return false;
            }
        }
    }

    return true;
}

function groupTransactionsByTokenAddress(transactions: any[], traceId: string, moxieUserId: string): Map<string, any[]> {
    const groupedTransactions: Map<string, any[]> = new Map();

    for (const transaction of transactions) {
        let tokenAddress: string | null = null;

        switch (transaction.orderType) {
            case "BUY":
            case "LIMIT_ORDER_BUY":
                tokenAddress = extractTokenDetails(transaction.buyToken).tokenAddress;
                break;
            case "SELL":
            case "STOP_LOSS":
            case "LIMIT_ORDER_SELL":
                tokenAddress = extractTokenDetails(transaction.sellToken).tokenAddress;
                break;
            default:
                elizaLogger.warn(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [groupTransactionsByTokenAddress] Unknown order type: ${transaction.orderType}`
                );
                continue;
        }

        if (tokenAddress) {
            if (!groupedTransactions.has(tokenAddress)) {
                groupedTransactions.set(tokenAddress, []);
            }
            groupedTransactions.get(tokenAddress)?.push(transaction);
        }
    }

    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [groupTransactionsByTokenAddress] groupedTransactions: ${JSON.stringify(Array.from(groupedTransactions.entries()))}`
    );

    return groupedTransactions;
}

async function handleOrderCreationResult(
    result: any,
    tokenAddress: string,
    traceId: string,
    moxieUserId: string,
    swapInput: SwapInput,
    limitOrderInput: OpenOrderInput[],
    swapOrderType: OrderType,
    callback?: any
) {
    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [handleOrderCreationResult] result: ${JSON.stringify(result)}`
    );

    if (!result.success) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleOrderCreationResult] Could not create orders: ${JSON.stringify(result)}`
        );
        await callback?.({
            text: `⚠️ Something went wrong. Please try again. \n`,
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });
    }

    let ordersViewAvailable = false;

    if (result.success && result.metadata?.swapOutput) {
        ordersViewAvailable = true;
        const swapOutput = result.metadata.swapOutput;

        let amount: string;
        let tokenSymbol: string;
        let tokenAddress: string;
        let price: string;

        if (swapOrderType == OrderType.BUY) {
            amount = swapOutput.buyAmount;
            tokenSymbol = swapInput.buyTokenSymbol;
            tokenAddress = swapInput.buyTokenAddress;
            price = swapOutput.buyPrice ? `$${swapOutput.buyPrice}` : "Price not available";
        } else if (swapOrderType == OrderType.SELL) {
            amount = swapOutput.sellAmount;
            tokenSymbol = swapInput.sellTokenSymbol;
            tokenAddress = swapInput.sellTokenAddress;
            price = swapOutput.buyPrice ? `$${swapOutput.buyPrice}` : "Price not available";
        }

        const message = [
            `&nbsp;\n✅ Swap order completed:\n`,
            `Amount: **${amount}** of $[${tokenSymbol}|${tokenAddress}] ${swapOrderType == OrderType.BUY ? "received" : "sold"}\n`,
            `Price: ${price}\n`,
            `View tx: [BaseScan](https://basescan.org/tx/${swapOutput.txHash})\n`
        ].join('');

        await callback?.({
            text: message,
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            }
        });
    }

    if (result.success && result.metadata?.stopLossOutputs) {
        ordersViewAvailable = true;
        const stopLossOutputs = result.metadata.stopLossOutputs;
        let message = '';
        stopLossOutputs.forEach(output => {
            const stopLossPrice = Number(output.stopLossPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 20 });
            const sellAmount = Number(output.sellAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 20 });
            if (output.triggerType === OrderTriggerType.PERCENTAGE) {
                message += `&nbsp;\n🛑 [-${output.triggerValue}%] Stop Loss created: \nSL Price: $${stopLossPrice} \nSell Quantity: ${sellAmount} \n`;
            } else if (output.triggerType === OrderTriggerType.TOKEN_PRICE) {
                message += `&nbsp;\n🛑 [$${stopLossPrice}] Stop Loss created: \nSL Price: $${stopLossPrice} \nSell Quantity: ${sellAmount} \n`;
            }
        });

        await callback?.({
            text: message,
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });
    }

    if (result.success && result.metadata?.limitOrderOutputs) {
        ordersViewAvailable = true;
        const limitOrderOutputs = result.metadata.limitOrderOutputs;
        let message = '';

        limitOrderOutputs.forEach((output, index) => {
            const limitPrice = Number(output.limitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 20 });
            const buyAmount = output.buyAmount && Number(output.buyAmount) > 0 ? Number(output.buyAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 20 }) : null;
            const sellAmount = output.sellAmount && Number(output.sellAmount) > 0 ? Number(output.sellAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 20 }) : null;
            const buyAmountUSD = output.buyAmountUSD && Number(output.buyAmountUSD) > 0 ? Number(output.buyAmountUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 20 }) : null;
            const triggerValue = output.triggerValue;

            if (output.triggerType === OrderTriggerType.PERCENTAGE) {
                if (output.sellAmount && Number(output.sellAmount) > 0) {
                    message += `&nbsp;\n📈 [+${triggerValue}%] Limit Sell created: \nLMT Price: $${limitPrice} \nSell Quantity: ${sellAmount} \n`;
                } else if (output.buyAmountUSD && Number(output.buyAmountUSD) > 0) {
                    message += `&nbsp;\n📉 [-${triggerValue}%] Limit Buy created: \nLMT Price: $${limitPrice} \nBuy Amount: $${buyAmountUSD} \n`;
                } else if (output.buyAmount && Number(output.buyAmount) > 0) {
                    message += `&nbsp;\n📉 [-${triggerValue}%] Limit Buy created: \nLMT Price: $${limitPrice} \nBuy Quantity: ${buyAmount} \n`;
                }
            } else if (output.triggerType === OrderTriggerType.TOKEN_PRICE) {
                if (output.sellAmount && Number(output.sellAmount) > 0) {
                    message += `&nbsp;\n📈 [LMT Price: $${limitPrice}] Limit Sell created: \nSell Quantity: ${sellAmount} \n`;
                } else if (output.buyAmountUSD && Number(output.buyAmountUSD) > 0) {
                    message += `&nbsp;\n📉 [LMT Price: $${limitPrice}] Limit Buy created: \nBuy Amount: $${buyAmountUSD} \n`;
                } else if (output.buyAmount && Number(output.buyAmount) > 0) {
                    message += `&nbsp;\n📉 [LMT Price: $${limitPrice}] Limit Buy created: \nBuy Quantity: ${buyAmount} \n`;
                }
            }
        });

        await callback?.({
            text: message,
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });

        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleOrderCreationResult] Order creation result handled successfully`
        );
    }

    if (ordersViewAvailable) {
        await callback?.({
            text: '',
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
            cta: "DYNAMIC_CTA",
            metadata: {
                cta: {
                    label: "Open Orders",
                    path: ActiveViewType.ORDERS,
                    message: "View Orders",
                    type: "NAVIGATE",
                }
            }
        });
    }
}

async function handleError(error: any, traceId: string, moxieUserId: string, callback?: any) {
    if (error instanceof Error) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleError] [SWAP] error stacktrace: ${error.stack}`
        );
    } else {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleError] [SWAP] error occurred while placing orders: ${error}`
        );
    }
    if (
        error.message ==
        "Wallet has insufficient funds to execute the transaction (transaction amount + fees)"
    ) {
        await callback?.(insufficientEthBalanceTemplate);
    }
    else {
        await callback?.(swapOperationFailedTemplate(error));
    }
}

async function clearCache(runtime: IAgentRuntime, moxieUserId: string, traceId: string) {
    const cacheKey = `PORTFOLIO-V2-${moxieUserId}`;
    await runtime.cacheManager.delete(cacheKey);
    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [clearCache] [CACHE] deleted cache key: ${cacheKey}`
    );
}

async function handleBuyQuantity(
    buyQuantity: number,
    valueType: string,
    extractedSellTokenSymbol: string,
    extractedSellTokenAddress: string,
    extractedSellTokenDecimals: number,
    extractedBuyTokenSymbol: string,
    extractedBuyTokenAddress: string,
    extractedBuyTokenDecimals: number,
    traceId: string,
    moxieUserId: string,
    agentWallet: MoxieClientWallet,
    callback?: any,
    state?: State
): Promise<{swapInput: SwapInput | undefined, error: boolean}> {

    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] buyQuantity: ${buyQuantity}`
    );

    let error = false;
    let swapInput: SwapInput | undefined;

    let buyQuantityInWEI = ethers.parseUnits(buyQuantity.toString(), extractedBuyTokenDecimals);

    if (valueType && valueType == USD) {
        buyQuantityInWEI = ethers.parseUnits(buyQuantity.toString(), USDC_TOKEN_DECIMALS);

        try {
            if (extractedSellTokenSymbol != USDC) {

                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] extractedSellTokenSymbol: ${extractedSellTokenSymbol}`
                );

                const price = await getPrice(
                    traceId,
                    moxieUserId,
                    buyQuantityInWEI.toString(),
                    USDC_ADDRESS,
                    USDC_TOKEN_DECIMALS,
                    USDC,
                    extractedSellTokenAddress,
                    extractedSellTokenDecimals,
                    extractedSellTokenSymbol
                );

                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] price: ${price}`
                );

                buyQuantityInWEI = BigInt(price);
            }

            if (extractedSellTokenSymbol != extractedBuyTokenSymbol) {
                try {
                    swapInput = {
                        sellTokenAddress: extractedSellTokenAddress,
                        buyTokenAddress: extractedBuyTokenAddress,
                        amount: buyQuantityInWEI.toString(),
                        chainId: BASE_NETWORK_ID,
                        sellTokenSymbol: extractedSellTokenSymbol,
                        buyTokenSymbol: extractedBuyTokenSymbol,
                        sellTokenDecimal: Number(extractedSellTokenDecimals),
                        buyTokenDecimal: Number(extractedBuyTokenDecimals),
                    }
                    elizaLogger.debug(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] swapInput: ${JSON.stringify(swapInput)}`
                    );
                    return {swapInput, error};
                } catch (error) {
                    elizaLogger.error(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] Error in processing swap input: ${error}`
                    );
                    callback?.({
                        text: `⚠️ Unfortunately, the Swap failed. Please try again.\n`,
                        content: {
                            action: "SENPI_ORDERS",
                            inReplyTo: traceId,
                        },
                    });
                    return {swapInput: undefined, error: true};
                }
            }
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] error: ${error}`
            );
            callback?.({
                text: `⚠️ Unfortunately, the Swap failed. Please try again. \n`,
                content: {
                    action: "SENPI_ORDERS",
                    inReplyTo: traceId,
                },
            });
            return {swapInput: undefined, error: true};
        }
    } else {
        elizaLogger.info(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] evaluate how much sell token is required to buy the buy token`
        );

        const price = await getPrice(
            traceId,
            moxieUserId,
            buyQuantityInWEI.toString(),
            extractedBuyTokenAddress,
            extractedBuyTokenDecimals,
            extractedBuyTokenSymbol,
            extractedSellTokenAddress,
            extractedSellTokenDecimals,
            extractedSellTokenSymbol
        );

        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] price: ${price}`
        );

        buyQuantityInWEI = BigInt(price);

        const currentSellTokenBalanceInWEI =
            extractedSellTokenSymbol === ETH
                ? await getNativeTokenBalance(
                        traceId,
                        agentWallet.address
                    )
                : await getERC20Balance(
                        traceId,
                        extractedSellTokenAddress,
                        agentWallet.address
        );

        if (
            BigInt(currentSellTokenBalanceInWEI) <
            buyQuantityInWEI
        ) {
            elizaLogger.error(
                traceId,
                `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] Insufficient balance for sell token: ${extractedSellTokenSymbol}`
            );

            await handleInsufficientBalance(
                traceId,
                state.agentWalletBalance,
                moxieUserId,
                extractedSellTokenAddress,
                extractedSellTokenSymbol,
                buyQuantityInWEI,
                BigInt(currentSellTokenBalanceInWEI),
                extractedSellTokenDecimals,
                agentWallet.address,
                callback,
                extractedBuyTokenAddress
            );

            return {swapInput: undefined, error: true};
        }

        elizaLogger.info(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleBuyQuantity] Preparing swap input`
        );

        swapInput = {
            sellTokenAddress: extractedSellTokenAddress,
            buyTokenAddress: extractedBuyTokenAddress,
            amount: buyQuantityInWEI.toString(),
            chainId: BASE_NETWORK_ID,
            sellTokenSymbol: extractedSellTokenSymbol,
            buyTokenSymbol: extractedBuyTokenSymbol,
            sellTokenDecimal: Number(extractedSellTokenDecimals),
            buyTokenDecimal: Number(extractedBuyTokenDecimals),
        }

        return {swapInput, error};
    }
}

async function handleInsufficientBalance(
    traceId: string,
    currentWalletBalance,
    moxieUserId: string,
    sellTokenAddress: string,
    sellTokenSymbol: string,
    sellAmountInWEI: bigint,
    tokenBalance: bigint,
    sellTokenDecimals: number,
    agentWalletAddress: string,
    callback: HandlerCallback,
    buyTokenAddress: string
) {
    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [handleInsufficientBalance] [currentWalletBalance]: ${JSON.stringify(currentWalletBalance)}`
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
        indicativePriceOfBuyTokenInUSD = ethers.formatUnits(
            price,
            USDC_TOKEN_DECIMALS
        );
    } else {
        indicativePriceOfBuyTokenInUSD = ethers.formatUnits(
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
        `[senpiOrders] [${moxieUserId}] [handleInsufficientBalance] [otherTokensWithSufficientBalance]: ${JSON.stringify(otherTokensWithSufficientBalance)}`
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
        `[senpiOrders] [${moxieUserId}] [handleInsufficientBalance] [otherTokenSymbols]: ${JSON.stringify(otherTokenSymbols)}`
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

    await callback?.({
        text:
            otherTokensWithSufficientBalance.length === 0
                ? `&nbsp;\nNot enough ${sellTokenSymbol} in your bag!\n` +
                  `Current balance: ${ethers.formatUnits(tokenBalance, sellTokenDecimals)} ${sellTokenSymbol}\n` +
                  `Required amount: ${ethers.formatUnits(sellAmountInWEI, sellTokenDecimals)} ${sellTokenSymbol}\n` +
                  `Please top up with ${ethers.formatUnits(sellAmountInWEI - BigInt(tokenBalance), sellTokenDecimals)} ${sellTokenSymbol} to proceed.\n`
                : `I can do that for you. Would you like me to use your ${otherTokenSymbols.slice(0, -1).join(", ")}${otherTokenSymbols.length > 1 ? " or " : ""}${otherTokenSymbols[otherTokenSymbols.length - 1]} ?
                \n<!--
                \n${otherTokenSymbols
                    .map((symbol) => {
                        const token = otherTokenSymbolsMap[symbol];
                        return `• ${symbol} (${
                            symbol === ETH
                                ? ETH_ADDRESS
                                : symbol === USDC
                                  ? USDC_ADDRESS
                                  : token.token.baseToken.address
                        }): ${token.token.balance} (${token.token.balanceUSD} USD)`;
                    })
                    .join("\n")}
                \n-->
            `,
    });
}

async function handleSellQuantity(
    sellQuantity: number,
    valueType: string,
    extractedSellTokenSymbol: string,
    extractedSellTokenAddress: string,
    extractedSellTokenDecimals: number,
    extractedBuyTokenSymbol: string,
    extractedBuyTokenAddress: string,
    extractedBuyTokenDecimals: number,
    traceId: string,
    moxieUserId: string,
    agentWallet: MoxieClientWallet,
    callback?: any,
    state?: State
): Promise<{swapInput: SwapInput | undefined, error: boolean}> {
    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [handleSellQuantity] sellQuantity: ${sellQuantity}`
    );

    let error = false;
    let swapInput: SwapInput | undefined;

    if (valueType && valueType == USD && extractedSellTokenAddress != USDC_ADDRESS) {
        const sellQuantityInUSDWEI = ethers.parseUnits(sellQuantity.toString(), USDC_TOKEN_DECIMALS);

        const priceOfSellTokenFromUSDInWei =
            await getPrice(
                traceId,
                moxieUserId,
                sellQuantityInUSDWEI.toString(),
                USDC_ADDRESS,
                USDC_TOKEN_DECIMALS,
                USDC,
                extractedSellTokenAddress,
                extractedSellTokenDecimals,
                extractedSellTokenSymbol
        );

        const sellQuantityInWEI = BigInt(priceOfSellTokenFromUSDInWei);

        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellQuantity] priceOfSellTokenFromUSDInWei: ${priceOfSellTokenFromUSDInWei}`
        );

        const currentSellTokenBalanceInWEI =
            extractedSellTokenSymbol === "ETH"
                ? await getNativeTokenBalance(
                    traceId,
                    agentWallet.address
                )
                : await getERC20Balance(
                    traceId,
                    extractedSellTokenAddress,
                agentWallet.address
        );

        if (
            BigInt(currentSellTokenBalanceInWEI) <
            sellQuantityInWEI
        ) {
            elizaLogger.error(
                traceId,
                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [SELL_QUANTITY] [USD_VALUE_TYPE] insufficient balance: ${currentSellTokenBalanceInWEI} < ${Number(priceOfSellTokenFromUSDInWei)}`
            );
            await callback({
                text: `⚠️ Insufficient ${extractedSellTokenSymbol} balance. \n Current balance: ${ethers.formatUnits(currentSellTokenBalanceInWEI, extractedSellTokenDecimals)} ${extractedSellTokenSymbol} \n Required amount: ${ethers.formatUnits(sellQuantityInWEI, extractedSellTokenDecimals)} ${extractedSellTokenSymbol} \n Please top up with ${ethers.formatUnits(sellQuantityInWEI - BigInt(currentSellTokenBalanceInWEI), extractedSellTokenDecimals)} ${extractedSellTokenSymbol} to proceed.\n`,
            });
            return {swapInput: undefined, error: true};
        }

        swapInput = {
            sellTokenAddress: extractedSellTokenAddress,
            buyTokenAddress: extractedBuyTokenAddress,
            amount: sellQuantityInWEI.toString(),
            chainId: BASE_NETWORK_ID,
            sellTokenSymbol: extractedSellTokenSymbol,
            buyTokenSymbol: extractedBuyTokenSymbol,
            sellTokenDecimal: Number(extractedSellTokenDecimals),
            buyTokenDecimal: Number(extractedBuyTokenDecimals),
        }

        return {swapInput, error};

    } else {
        const sellQuantityInWEI = ethers.parseUnits(
            sellQuantity.toString(),
            extractedSellTokenDecimals
        );

        const currentSellTokenBalanceInWEI =
            extractedSellTokenSymbol === "ETH"
                ? await getNativeTokenBalance(
                    traceId,
                    agentWallet.address
                )
                : await getERC20Balance(
                    traceId,
                    extractedSellTokenAddress,
                    agentWallet.address
        );

        if (
            BigInt(currentSellTokenBalanceInWEI) <
            sellQuantityInWEI
        ) {
            elizaLogger.error(
                traceId,
                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [SELL_QUANTITY] [USD_VALUE_TYPE] insufficient balance: ${currentSellTokenBalanceInWEI} < ${sellQuantityInWEI}`
            );
            await callback({
                text: `⚠️ Insufficient ${extractedSellTokenSymbol} balance. \n Current balance: ${ethers.formatUnits(currentSellTokenBalanceInWEI, extractedSellTokenDecimals)} ${extractedSellTokenSymbol} \n Required amount: ${ethers.formatUnits(sellQuantityInWEI, extractedSellTokenDecimals)} ${extractedSellTokenSymbol} \n Please top up with ${ethers.formatUnits(sellQuantityInWEI - BigInt(currentSellTokenBalanceInWEI), extractedSellTokenDecimals)} ${extractedSellTokenSymbol} to proceed.\n`,
            });
            return {swapInput: undefined, error: true};
        }

        swapInput = {
            sellTokenAddress: extractedSellTokenAddress,
            buyTokenAddress: extractedBuyTokenAddress,
            amount: sellQuantityInWEI.toString(),
            chainId: BASE_NETWORK_ID,
            sellTokenSymbol: extractedSellTokenSymbol,
            buyTokenSymbol: extractedBuyTokenSymbol,
            sellTokenDecimal: Number(extractedSellTokenDecimals),
            buyTokenDecimal: Number(extractedBuyTokenDecimals),
        }
        return {swapInput, error};
    }
}

async function getTargetQuantityForBalanceBasedSwaps(
    traceId: string,
    currentWalletBalance: bigint | undefined,
    moxieUserId: string,
    sellTokenAddress: string,
    sellTokenSymbol: string,
    agentWallet: any,
    balance: {
        sourceToken: string;
        type: "FULL" | "PERCENTAGE";
        value: number;
    },
    callback: any
): Promise<{ quantityInWEI: bigint; currentWalletBalance: bigint }> {
    let quantityInWEI: bigint;
    if (!currentWalletBalance) {
        currentWalletBalance = BigInt(
            sellTokenSymbol === "ETH"
                ? await getNativeTokenBalance(traceId, agentWallet.address)
                : await getERC20Balance(
                      traceId,
                      sellTokenAddress,
                      agentWallet.address
                  )
        );
    }
    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [getTargetQuantityForBalanceBasedSwaps] currentWalletBalance: ${currentWalletBalance} ${sellTokenAddress}`
    );
    if (!currentWalletBalance || currentWalletBalance === 0n) {
        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [balance] currentWalletBalance is ${currentWalletBalance}`
        );
        await callback?.({
            text: `Looks like your agent wallet needs a refill of ${sellTokenSymbol}. Top it up and let's try again! 🚀 \n`,
        });
        throw new Error(
            `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [balance] currentWalletBalance is ${currentWalletBalance}`
        );
    }

    // calculate the percentage to be used for the swap
    let percentage = balance.type === "FULL" ? 100 : balance.value;

    // If ETH and 100%, use 99% instead
    if (sellTokenSymbol === "ETH" && percentage === 100) {
        percentage = 99;
        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [balance] Using 99% instead of 100% for ETH`
        );
    }

    // Scale up by a larger factor (e.g., 1e7)
    quantityInWEI =
        (BigInt(currentWalletBalance) * BigInt(percentage * 1e7)) / BigInt(1e9);
    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [balance] quantityInWEI: ${quantityInWEI}`
    );
    return { quantityInWEI, currentWalletBalance };
}

async function handleBalanceBasedSwap(
    balance: {
        sourceToken: string;
        type: "FULL" | "PERCENTAGE";
        value: number;
    },
    extractedSellTokenSymbol: string,
    extractedSellTokenAddress: string,
    extractedSellTokenDecimals: number,
    extractedBuyTokenSymbol: string,
    extractedBuyTokenAddress: string,
    extractedBuyTokenDecimals: number,
    currentWalletBalanceForBalanceBasedSwaps: Map<string, bigint | undefined>,
    traceId: string,
    moxieUserId: string,
    agentWallet: MoxieClientWallet,
    callback?: any,
): Promise<{swapInput: SwapInput | undefined, error: boolean}> {

    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [handleBalanceBasedSwap] balance: ${JSON.stringify(balance)}`
    );

    let swapInput: SwapInput | undefined;
    let error = false;
    let quantityInWEI: bigint;

    try {

        const result = await getTargetQuantityForBalanceBasedSwaps(
            traceId,
            currentWalletBalanceForBalanceBasedSwaps[
                extractedSellTokenAddress
            ],
            moxieUserId,
            extractedSellTokenAddress,
            extractedSellTokenSymbol,
            agentWallet,
            balance,
            callback
        );

        quantityInWEI = result.quantityInWEI;
        currentWalletBalanceForBalanceBasedSwaps[
            extractedSellTokenAddress
        ] = result.currentWalletBalance;

        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleBalanceBasedSwap] quantityInWEI: ${quantityInWEI}`
        );

        swapInput = {
            sellTokenAddress: extractedSellTokenAddress,
            buyTokenAddress: extractedBuyTokenAddress,
            amount: quantityInWEI.toString(),
            chainId: BASE_NETWORK_ID,
            sellTokenSymbol: extractedSellTokenSymbol,
            buyTokenSymbol: extractedBuyTokenSymbol,
            sellTokenDecimal: Number(extractedSellTokenDecimals),
            buyTokenDecimal: Number(extractedBuyTokenDecimals),
        }

        return {swapInput, error};

    } catch (error) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleBalanceBasedSwap] error: ${error}`
        );
        await callback?.({
            text: `⚠️ Unfortunately, the Swap failed. Please try again. \n`,
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });
        return {swapInput: undefined, error: true};
    }
}

async function handleSwapOrder(
    transaction: any,
    extractedSellTokenSymbol: string,
    extractedSellTokenAddress: string,
    extractedSellTokenDecimals: number,
    extractedBuyTokenSymbol: string,
    extractedBuyTokenAddress: string,
    extractedBuyTokenDecimals: number,
    currentWalletBalanceForBalanceBasedSwaps: Map<string, bigint | undefined>,
    traceId: string,
    moxieUserId: string,
    agentWallet: MoxieClientWallet,
    callback?: any,
    state?: State
): Promise<{swapInput: SwapInput | undefined, error: boolean}> {

    elizaLogger.debug(
        traceId,
        `[senpiOrders] [${moxieUserId}] [handleSwapOrder] transaction: ${JSON.stringify(transaction)}`
    );

    let swapInput: SwapInput | undefined;
    let error = false;
    const { buyQuantity, sellQuantity, valueType } = transaction;

    if (buyQuantity) {
        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSwapOrder] buyQuantity: ${buyQuantity}`
        );
        const result = await handleBuyQuantity(
            buyQuantity,
            valueType,
            extractedSellTokenSymbol,
            extractedSellTokenAddress,
            extractedSellTokenDecimals,
            extractedBuyTokenSymbol,
            extractedBuyTokenAddress,
            extractedBuyTokenDecimals,
            traceId,
            moxieUserId,
            agentWallet,
            callback,
            state
        );
        swapInput = result.swapInput;
        error = result.error;

        if (error) {
            return {swapInput: undefined, error: true};
        } else {
            return {swapInput, error: false};
        }
    } else if (sellQuantity) {
        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSwapOrder] sellQuantity: ${sellQuantity}`
        );
        const result = await handleSellQuantity(
            sellQuantity,
            valueType,
            extractedSellTokenSymbol,
            extractedSellTokenAddress,
            extractedSellTokenDecimals,
            extractedBuyTokenSymbol,
            extractedBuyTokenAddress,
            extractedBuyTokenDecimals,
            traceId,
            moxieUserId,
            agentWallet,
            callback,
            state
        );
        swapInput = result.swapInput;
        error = result.error;

        if (error) {
            return {swapInput: undefined, error: true};
        } else {
            return {swapInput, error: false};
        }
    } else if (transaction.balance && transaction.balance.type && transaction.balance.value) {
        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSwapOrder] balance: ${JSON.stringify(transaction.balance)}`
        );
        const result = await handleBalanceBasedSwap(
            transaction.balance,
            extractedSellTokenSymbol,
            extractedSellTokenAddress,
            extractedSellTokenDecimals,
            extractedBuyTokenSymbol,
            extractedBuyTokenAddress,
            extractedBuyTokenDecimals,
            currentWalletBalanceForBalanceBasedSwaps,
            traceId,
            moxieUserId,
            agentWallet,
            callback,
        );
        swapInput = result.swapInput;
        error = result.error;
    } else {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSwapOrder] Invalid swap inputs for the token: ${extractedBuyTokenAddress}`
        );
        await callback?.({
            text: `⚠️ Please check the swap inputs for the token: ${extractedBuyTokenSymbol} (${extractedBuyTokenAddress}). Ensure all amounts and details are correct, then try again.\n`,
        });
        return {swapInput: undefined, error: true};
    }
    return {swapInput, error: false};
}

export async function extractTokenDetailsAndDecimalsWithCache(
    tokenAddress: string,
    traceId: string,
    moxieUserId: string,
    tokenAddressToSymbol: Map<string, string>,
    tokenAddressToDecimals: Map<string, number>
) {
    const lowerCaseAddress = tokenAddress.toLowerCase();
    const isETH = lowerCaseAddress === ETH_ADDRESS.toLowerCase();
    const isUSDC = lowerCaseAddress === USDC_ADDRESS.toLowerCase();

    if (isETH || isUSDC) {
        return {
            extractedTokenSymbol: isETH ? "ETH" : "USDC",
            extractedTokenAddress: isETH ? ETH_ADDRESS : USDC_ADDRESS,
            extractedTokenDecimals: isETH ? 18 : 6,
            tokenAddressToSymbol,
            tokenAddressToDecimals
        };
    }

    let extractedTokenSymbol, extractedTokenAddress, extractedTokenDecimals;

    if (ethers.isAddress(tokenAddress)) {
        extractedTokenAddress = tokenAddress;
        extractedTokenSymbol = tokenAddressToSymbol.get(tokenAddress) || await fetchAndCacheTokenSymbol(tokenAddress, traceId, moxieUserId, tokenAddressToSymbol);
    } else {
        const extracted = extractTokenDetails(tokenAddress);
        extractedTokenSymbol = extracted.tokenSymbol;
        extractedTokenAddress = extracted.tokenAddress;
    }

    const extractedLowerCaseAddress = extractedTokenAddress.toLowerCase();
    const isExtractedETH = extractedLowerCaseAddress === ETH_ADDRESS.toLowerCase();
    const isExtractedUSDC = extractedLowerCaseAddress === USDC_ADDRESS.toLowerCase();

    extractedTokenDecimals = (isExtractedETH || isExtractedUSDC) ? (isExtractedETH ? 18 : 6) : await fetchAndCacheTokenDecimals(extractedTokenAddress, traceId, tokenAddressToDecimals);

    return {
        extractedTokenSymbol,
        extractedTokenAddress,
        extractedTokenDecimals,
        tokenAddressToSymbol,
        tokenAddressToDecimals
    };
}

async function fetchAndCacheTokenSymbol(tokenAddress: string, traceId: string, moxieUserId: string, tokenAddressToSymbol: Map<string, string>): Promise<string> {
    try {
        const symbol = await getERC20TokenSymbol(tokenAddress);
        tokenAddressToSymbol.set(tokenAddress, symbol);
        return symbol;
    } catch (error) {
        elizaLogger.warn(traceId, `[senpiOrders] [${moxieUserId}] Failed to fetch token symbol from RPC: ${error}`);
        return "";
    }
}

async function fetchAndCacheTokenDecimals(tokenAddress: string, traceId: string, tokenAddressToDecimals: Map<string, number>): Promise<number> {
    if (!tokenAddressToDecimals.has(tokenAddress)) {
        const decimals = await getERC20Decimals(traceId, tokenAddress);
        tokenAddressToDecimals.set(tokenAddress, decimals);
        return decimals;
    }
    return tokenAddressToDecimals.get(tokenAddress)!;
}

async function validateSellOrder(transaction: any, traceId: string, moxieUserId: string, callback?: any): Promise<boolean> {

    // Check trigger type
    if (!transaction.triggerType) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] Missing trigger type for stop loss order: ${JSON.stringify(transaction)}`
        );
        await callback?.({
            text: "⚠️ Missing Sell Order trigger condition. Please specify a trigger type (e.g. percentage or value) and try again.\n",
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });
        return false;
    }

    // Check trigger price
    if (!transaction.triggerPrice) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] Missing trigger price for stop loss order: ${JSON.stringify(transaction)}`
        );
        await callback?.({
            text: "⚠️ Missing Sell Order trigger price. Please specify the trigger price value and try again.\n",
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });
        return false;
    }

    // Check balance object and its properties
    if (!transaction.balance) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] Missing balance for stop loss order: ${JSON.stringify(transaction)}`
        );
        await callback?.({
            text: "⚠️ Missing Sell Order balance configuration. Please specify the quantity or percentage to sell and try again.\n",
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });
        return false;
    }

    if (!transaction.balance.type) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] Missing balance type for stop loss order: ${JSON.stringify(transaction)}`
        );
        await callback?.({
            text: "⚠️ Missing Sell Order balance type. Please specify FULL, PERCENTAGE, or QUANTITY and try again.\n",
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });
        return false;
    }

    if (!transaction.balance.value) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] Missing balance value for stop loss order: ${JSON.stringify(transaction)}`
        );
        await callback?.({
            text: "⚠️ Missing Sell Order balance value. Please specify the quantity or percentage value and try again.\n",
            content: {
                action: "SENPI_ORDERS",
                inReplyTo: traceId,
            },
        });
        return false;
    }

    return true;
}

async function handleSellOrder(
    transaction: any,
    extractedSellTokenSymbol: string,
    extractedSellTokenAddress: string,
    extractedSellTokenDecimals: number,
    extractedBuyTokenSymbol: string,
    extractedBuyTokenAddress: string,
    extractedBuyTokenDecimals: number,
    traceId: string,
    moxieUserId: string,
    agentWallet: MoxieClientWallet,
    tokenAddressToPrice: Map<string, number>,
    walletAddressToTokenAddressToBalance: Map<string, bigint>,
    action: ActionType,
    callback?: any,
): Promise<{stopLossInput: OpenOrderInput[], limitOrderInput: OpenOrderInput[], error: boolean}> {

    let stopLossInput: OpenOrderInput[] = [];
    let limitOrderInput: OpenOrderInput[] = [];
    let error = false;

    const valid = await validateSellOrder(transaction, traceId, moxieUserId, callback);
    if (!valid) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] Invalid sell order: ${JSON.stringify(transaction)}`
        );
        return {stopLossInput: [], limitOrderInput: [], error: true};
    }

    let triggerPrice = Number(transaction.triggerPrice);
    let triggerBalanceValue = Number(transaction.balance.value);

    if ((extractedSellTokenSymbol === ETH && transaction.orderType !== OrderType.LIMIT_ORDER_BUY) ||
            (extractedBuyTokenSymbol === ETH && transaction.orderType === OrderType.LIMIT_ORDER_BUY)) {
            elizaLogger.error(
                traceId,
                `[senpiOrders] [${moxieUserId}] [handleSellOrder] Can't place a stop loss/ limit order for ETH`
            );
            await callback?.({
                text: "🛑 Stop-loss and limit orders are not supported for ETH. You can wrap it to WETH and try again.\n",
            });
            return {stopLossInput: [], limitOrderInput: [], error: true};
    }

    let doBalanceCheck = true;
    if (action == ActionType.SWAP_SL || action == ActionType.SWAP_SL_LO || action == ActionType.SWAP_LO) {
        doBalanceCheck = false;
    }

    try {
        const sellTokenPriceInUSD = await fetchTokenPriceInUSD(
            extractedSellTokenAddress,
            traceId,
            moxieUserId,
            tokenAddressToPrice
        );

        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] sellTokenPriceInUSD: ${sellTokenPriceInUSD}`
        );

        const errorMessage = validatePriceConditions(transaction, triggerPrice, sellTokenPriceInUSD, traceId, moxieUserId);
        if (errorMessage) {
            await callback?.({
                text: errorMessage,
            });
            return {stopLossInput: [], limitOrderInput: [], error: true};
        }

        const tokenBalance = await fetchAgentWalletTokenBalance(
            agentWallet,
            extractedSellTokenAddress,
            extractedSellTokenSymbol,
            traceId,
            walletAddressToTokenAddressToBalance
        );

        elizaLogger.debug(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] tokenBalance for ${extractedSellTokenSymbol} in agent wallet is: ${tokenBalance}`
        );

        if (transaction.orderType == OrderType.STOP_LOSS || transaction.orderType == OrderType.LIMIT_ORDER_SELL) {
            const sellOrderType = transaction.orderType == OrderType.STOP_LOSS ? "stop loss" : "limit";
            const formattedTokenBalance = tokenBalance > 0n
                ? parseFloat(ethers.formatUnits(tokenBalance.toString(), extractedSellTokenDecimals))
                : 0;

            elizaLogger.debug(
                traceId,
                `[senpiOrders] [${moxieUserId}] [handleSellOrder] starting to validate the ${sellOrderType} order with formattedTokenBalance: ${formattedTokenBalance}`
            );

            if (doBalanceCheck) {

                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] performing balance check`
                );

                const balanceCheckError = await performBalanceCheck(
                    tokenBalance,
                    formattedTokenBalance,
                    triggerBalanceValue,
                    extractedSellTokenSymbol,
                    sellOrderType,
                    transaction,
                    traceId,
                    moxieUserId,
                    callback
                );
                if (balanceCheckError) {
                    return {stopLossInput: [], limitOrderInput: [], error: true};
                }

                let sellValueInWEI: bigint;
                let sellValue: number;

                if (transaction.balance.type === BalanceType.PERCENTAGE) {
                    // Calculate percentage directly on the WEI balance to avoid precision loss
                    sellValueInWEI = (tokenBalance * BigInt(triggerBalanceValue)) / BigInt(100);
                    elizaLogger.debug(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleSellOrder] sellValueInWEI (percentage): ${sellValueInWEI}`
                    );
                } else if (transaction.balance.type === BalanceType.QUANTITY) {
                    // Convert the quantity to WEI
                    sellValueInWEI = ethers.parseUnits(triggerBalanceValue.toString(), extractedSellTokenDecimals);
                    elizaLogger.debug(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleSellOrder] sellValueInWEI (quantity): ${sellValueInWEI}`
                    );
                } else if (transaction.balance.type === BalanceType.FULL) {
                    // Use the full balance in WEI
                    sellValueInWEI = tokenBalance;
                    elizaLogger.debug(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleSellOrder] sellValueInWEI (full): ${sellValueInWEI}`
                    );
                }

                sellValue = parseFloat(ethers.formatUnits(sellValueInWEI.toString(), extractedSellTokenDecimals));

                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] sellValue: ${sellValue}`
                );

                let triggerPriceOrPercentage: string;
                if (transaction.triggerType == TriggerType.PERCENTAGE) {
                    triggerPriceOrPercentage = triggerPrice.toString();
                } else if (transaction.triggerType == TriggerType.ABSOLUTE_VALUE) {
                    triggerPriceOrPercentage = triggerPrice.toString();
                } else if (transaction.triggerType == TriggerType.VALUE_PRICE_DROP && transaction.orderType == OrderType.STOP_LOSS) {
                    triggerPriceOrPercentage = (sellTokenPriceInUSD - triggerPrice * (triggerBalanceValue / 100)).toString();
                } else if (transaction.triggerType == TriggerType.VALUE_PRICE_INCREASE && transaction.orderType == OrderType.LIMIT_ORDER_SELL) {
                    triggerPriceOrPercentage = (sellTokenPriceInUSD + triggerPrice * (triggerBalanceValue / 100)).toString();
                }

                if (!triggerPriceOrPercentage) {
                    elizaLogger.error(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleSellOrder] Could not calculate trigger price or percentage`
                    );
                    await callback?.({
                        text: `⚠️ Something's off — couldn’t calculate the trigger for your ${transaction.orderType} order. Please give it another shot!\n`,
                    });
                    return {stopLossInput: [], limitOrderInput: [], error: true};
                }

                const openOrderInput: OpenOrderInput = {
                    sellAmountInWei: sellValueInWEI.toString(),
                    sellAmount: sellValue.toString(),
                    sellTokenAddress: extractedSellTokenAddress,
                    sellTokenSymbol: extractedSellTokenSymbol,
                    sellTokenDecimals: Number(extractedSellTokenDecimals),
                    buyTokenDecimals: Number(extractedBuyTokenDecimals),
                    buyTokenAddress: extractedBuyTokenAddress,
                    buyTokenSymbol: extractedBuyTokenSymbol,
                    triggerValue: triggerPriceOrPercentage,
                    triggerType: transaction.triggerType == TriggerType.PERCENTAGE ? OrderTriggerType.PERCENTAGE : OrderTriggerType.TOKEN_PRICE,
                    requestType: transaction.orderType == OrderType.STOP_LOSS ? RequestType.STOP_LOSS : RequestType.LIMIT_ORDER,
                };

                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] openOrderInput: ${JSON.stringify(openOrderInput)}`
                );

                if (transaction.orderType == OrderType.STOP_LOSS) {
                    stopLossInput.push(openOrderInput);
                } else if (transaction.orderType == OrderType.LIMIT_ORDER_SELL) {
                    openOrderInput.limitOrderType = LimitOrderType.LIMIT_SELL;
                    limitOrderInput.push(openOrderInput);
                }
            } else {

                // This is when stop loss or limit order is triggered with swaps

                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] This is when stop loss or limit order is triggered with swaps`
                );

                if (!triggerBalanceValue) {
                    elizaLogger.error(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleSellOrder] Do not know how much to sell`
                    );
                    await callback?.({
                        text: `⚠️ Sell percentage is missing for ${transaction.orderType} order. Please make sure to add it to your prompt and try again.\n`,
                    });
                    return {stopLossInput: [], limitOrderInput: [], error: true};
                }

                let percentageToSell: number;
                if (transaction.balance.type === BalanceType.PERCENTAGE && triggerBalanceValue) {
                    percentageToSell = triggerBalanceValue;
                } else if (transaction.balance.type === BalanceType.FULL) {
                    percentageToSell = 100;
                } else if (transaction.balance.type === BalanceType.QUANTITY) {
                    elizaLogger.error(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleSellOrder] Quantity is not supported when setting up ${transaction.orderType} order with swaps`
                    );
                    await callback?.({
                        text: `⚠️ Quantity input is not supported for ${transaction.orderType} orders with swaps. Please make sure update your prompt and try again.\n`,
                    });
                    return {stopLossInput: [], limitOrderInput: [], error: true};
                }

                if (!percentageToSell) {
                    elizaLogger.error(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [handleSellOrder] Do not know how much to sell`
                    );
                    await callback?.({
                        text: `⚠️ Sell percentage missing for ${transaction.orderType} order. Please make sure to add it to your prompt and try again.\n`,
                    });
                    return {stopLossInput: [], limitOrderInput: [], error: true};
                }

                let triggerPriceOrPercentage: string;
                if (transaction.triggerType == TriggerType.PERCENTAGE) {
                    triggerPriceOrPercentage = triggerPrice.toString();
                } else if (transaction.triggerType == TriggerType.ABSOLUTE_VALUE) {
                    triggerPriceOrPercentage = triggerPrice.toString();
                } else if (transaction.triggerType == TriggerType.VALUE_PRICE_DROP && transaction.orderType == OrderType.STOP_LOSS) {
                    triggerPriceOrPercentage = (sellTokenPriceInUSD - triggerPrice * (triggerBalanceValue / 100)).toString();
                } else if (transaction.triggerType == TriggerType.VALUE_PRICE_INCREASE && transaction.orderType == OrderType.LIMIT_ORDER_SELL) {
                    triggerPriceOrPercentage = (sellTokenPriceInUSD + triggerPrice * (triggerBalanceValue / 100)).toString();
                }

                const openOrderInput: OpenOrderInput = {
                    sellTokenAddress: extractedSellTokenAddress,
                    sellTokenSymbol: extractedSellTokenSymbol,
                    sellTokenDecimals: Number(extractedSellTokenDecimals),
                    buyTokenDecimals: Number(extractedBuyTokenDecimals),
                    sellPercentage: percentageToSell.toString(),
                    buyTokenAddress: extractedBuyTokenAddress,
                    buyTokenSymbol: extractedBuyTokenSymbol,
                    triggerValue: triggerPriceOrPercentage,
                    triggerType: transaction.triggerType == TriggerType.PERCENTAGE ? OrderTriggerType.PERCENTAGE : OrderTriggerType.TOKEN_PRICE,
                    requestType: transaction.orderType == OrderType.STOP_LOSS ? RequestType.STOP_LOSS : RequestType.LIMIT_ORDER,
                };

                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] openOrderInput: ${JSON.stringify(openOrderInput)}`
                );

                if (transaction.orderType == OrderType.STOP_LOSS) {
                    stopLossInput.push(openOrderInput);
                } else if (transaction.orderType == OrderType.LIMIT_ORDER_SELL) {
                    openOrderInput.limitOrderType = LimitOrderType.LIMIT_SELL;
                    limitOrderInput.push(openOrderInput);
                }

            }

        } else if (transaction.orderType == OrderType.LIMIT_ORDER_BUY) {
            elizaLogger.debug(
                traceId,
                `[senpiOrders] [${moxieUserId}] [handleSellOrder] starting to validate the limit order`
            );

            const { buyQuantity, valueType, } = transaction;

            let buyValueInWEI: bigint;
            let buyValue: number;
            let buyValueInUSD: number;

            if (!buyQuantity) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] Do not know how much to buy`
                );
                await callback?.({
                    text: `⚠️ Buy amount not specified for ${transaction.orderType} order. Please make sure to add it to your prompt as either amount or USD value, and try again.\n`,
                });
                return {stopLossInput: [], limitOrderInput: [], error: true};
            }

            const buyTokenPriceInUSD = await fetchTokenPriceInUSD(
                extractedBuyTokenAddress,
                traceId,
                moxieUserId,
                tokenAddressToPrice
            );

            if (!buyTokenPriceInUSD) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] Could not fetch price for buy token: ${extractedBuyTokenAddress}`
                );
                await callback?.({
                    text: `⚠️ Could not retrieve price for ${extractedBuyTokenAddress}. Unfortunately,  ${transaction.orderType} order setup failed. Please try again!\n`,
                });
                return {stopLossInput: [], limitOrderInput: [], error: true};
            }

            if (buyQuantity) {
                buyValueInWEI = ethers.parseUnits(buyQuantity.toString(), extractedBuyTokenDecimals);
                buyValue = parseFloat(ethers.formatUnits(buyValueInWEI.toString(), extractedBuyTokenDecimals));

                if (valueType === USD) {
                    // buyValue = buyQuantity / buyTokenPriceInUSD;
                    // buyValueInWEI = ethers.parseUnits(buyValue.toString(), extractedBuyTokenDecimals);
                    buyValueInUSD = buyQuantity;
                }
            } else {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] Buy quantity is not specified`
                );
                await callback?.({
                    text: `⚠️ Buy quantity missing for ${transaction.orderType} order. Please make sure to add it to your prompt and try again.\n`,
                });
                return {stopLossInput: [], limitOrderInput: [], error: true};
            }

            let triggerPriceOrPercentage: number;
                if (transaction.triggerType == TriggerType.PERCENTAGE) {
                    triggerPriceOrPercentage = triggerPrice;
                } else if (transaction.triggerType == TriggerType.ABSOLUTE_VALUE) {
                    triggerPriceOrPercentage = triggerPrice;
                } else if (transaction.triggerType == TriggerType.VALUE_PRICE_DROP && transaction.orderType == OrderType.STOP_LOSS) {
                    triggerPriceOrPercentage = sellTokenPriceInUSD - triggerPrice * (triggerBalanceValue / 100);
                } else if (transaction.triggerType == TriggerType.VALUE_PRICE_INCREASE && transaction.orderType == OrderType.LIMIT_ORDER_SELL) {
                    triggerPriceOrPercentage = sellTokenPriceInUSD + triggerPrice * (triggerBalanceValue / 100);
                }

            elizaLogger.debug(
                traceId,
                `[senpiOrders] [${moxieUserId}] [handleSellOrder] triggerPriceOrPercentage: ${triggerPriceOrPercentage}`
            );

            if (!triggerPriceOrPercentage) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [handleSellOrder] Could not calculate trigger price or percentage`
                );
                await callback?.({
                    text: `⚠️ Could not calculate trigger price or percentage for ${extractedBuyTokenAddress}. Unfortunately,  ${transaction.orderType} order setup failed. Please try again!\n`,
                });
                return {stopLossInput: [], limitOrderInput: [], error: true};
            }

            let openOrderInput: OpenOrderInput;
            if (valueType === USD) {
                openOrderInput = {
                    buyAmountUSD: buyValueInUSD.toString(),
                    buyTokenAddress: extractedBuyTokenAddress,
                    buyTokenSymbol: extractedBuyTokenSymbol,
                    buyTokenDecimals: Number(extractedBuyTokenDecimals),
                    sellTokenAddress: extractedSellTokenAddress,
                    sellTokenSymbol: extractedSellTokenSymbol,
                    sellTokenDecimals: Number(extractedSellTokenDecimals),
                    triggerValue: triggerPriceOrPercentage.toString(),
                    triggerType: transaction.triggerType == TriggerType.PERCENTAGE ? OrderTriggerType.PERCENTAGE : OrderTriggerType.TOKEN_PRICE,
                    requestType: transaction.orderType == OrderType.STOP_LOSS ? RequestType.STOP_LOSS : RequestType.LIMIT_ORDER,
                    limitOrderType: LimitOrderType.LIMIT_BUY,
                }
            } else {
                openOrderInput = {
                    buyAmountInWei: buyValueInWEI.toString(),
                    buyAmount: buyValue.toString(),
                    buyTokenAddress: extractedBuyTokenAddress,
                    buyTokenSymbol: extractedBuyTokenSymbol,
                    buyTokenDecimals: Number(extractedBuyTokenDecimals),
                    sellTokenAddress: extractedSellTokenAddress,
                    sellTokenSymbol: extractedSellTokenSymbol,
                    sellTokenDecimals: Number(extractedSellTokenDecimals),
                    triggerValue: triggerPriceOrPercentage.toString(),
                    triggerType: transaction.triggerType == TriggerType.PERCENTAGE ? OrderTriggerType.PERCENTAGE : OrderTriggerType.TOKEN_PRICE,
                    requestType: transaction.orderType == OrderType.STOP_LOSS ? RequestType.STOP_LOSS : RequestType.LIMIT_ORDER,
                    limitOrderType: LimitOrderType.LIMIT_BUY,
                }
            }

            limitOrderInput.push(openOrderInput);

        } else {
            elizaLogger.error(
                traceId,
                `[senpiOrders] [${moxieUserId}] [handleSellOrder] unknown order type: ${transaction.orderType}`
            );
            await callback?.({
                text: `⚠️ Unfortunately, an error occurred while processing your Sell Order (limit/stop loss). Please try again.\n`,
            });
            return {stopLossInput: [], limitOrderInput: [], error: true};
        }

    } catch (error) {
        handleSellOrderError(error, traceId, moxieUserId, callback);
        return {stopLossInput: [], limitOrderInput: [], error: true};
    }

    return {stopLossInput, limitOrderInput, error};
}

async function fetchTokenPriceInUSD(
    extractedTokenAddress: string,
    traceId: string,
    moxieUserId: string,
    tokenAddressToPrice: Map<string, number>
): Promise<number> {
    let tokenPriceInUSD = tokenAddressToPrice.get(extractedTokenAddress);
    if (!tokenPriceInUSD) {
        tokenPriceInUSD = Number(await getUSDPrice(traceId, moxieUserId, extractedTokenAddress));
        tokenAddressToPrice.set(extractedTokenAddress, tokenPriceInUSD);
    }
    return tokenPriceInUSD;
}

async function fetchAgentWalletTokenBalance(
    agentWallet: MoxieClientWallet,
    extractedSellTokenAddress: string,
    extractedSellTokenSymbol: string,
    traceId: string,
    walletAddressToTokenAddressToBalance: Map<string, bigint>
): Promise<bigint> {
    const key = `${agentWallet.address}-${extractedSellTokenAddress}`;
    let tokenBalance = walletAddressToTokenAddressToBalance.get(key);
    if (!tokenBalance) {
        if (extractedSellTokenSymbol && extractedSellTokenSymbol === ETH) {
            tokenBalance = BigInt(await getNativeTokenBalance(traceId, agentWallet.address));
        } else {
            tokenBalance = BigInt(await getERC20Balance(traceId, extractedSellTokenAddress, agentWallet.address));
        }
        walletAddressToTokenAddressToBalance.set(key, tokenBalance);
    }
    return tokenBalance;
}

async function performBalanceCheck(
    tokenBalance: bigint,
    formattedTokenBalance: number,
    triggerBalanceValue: number,
    extractedSellTokenSymbol: string,
    sellOrderType: string,
    transaction: any,
    traceId: string,
    moxieUserId: string,
    callback?: any
): Promise<boolean> {
    if (tokenBalance === BigInt(0)) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] token balance is 0`
        );
        await callback?.({
            text: `⚠️ Insufficient ${extractedSellTokenSymbol} balance for ${sellOrderType} order.\n`,
        });
        return true;
    } else if (transaction.balance.type === BalanceType.QUANTITY && triggerBalanceValue > formattedTokenBalance) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] trigger balance value is greater than token balance`
        );
        await callback?.({
            text: `⚠️ Insufficient ${extractedSellTokenSymbol} balance for ${sellOrderType} order. \n&nbsp;\nBalance: ${formattedTokenBalance} ${extractedSellTokenSymbol}\nRequired amount: ${triggerBalanceValue} ${extractedSellTokenSymbol}\n`,
        });
        return true;
    }
    return false;
}

function handleSellOrderError(
    error: any,
    traceId: string,
    moxieUserId: string,
    callback?: any
) {
    if (error instanceof Error) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] error: ${error.stack}`
        );
    } else {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] error: ${error}`
        );
    }
    elizaLogger.error(
        traceId,
        `[senpiOrders] [${moxieUserId}] [handleSellOrder] error: ${error}`
    );
    callback?.({
        text: `⚠️ Something went wrong while setting up your Sell Order (limit/stop loss). Please try again.\n`,
    });
}

function validatePriceConditions(transaction: any, triggerPrice: number, sellTokenPriceInUSD: number, traceId: string, moxieUserId: string): string {
    let errorMessage = "";

    if (transaction.triggerType == TriggerType.ABSOLUTE_VALUE) {
        if (triggerPrice > sellTokenPriceInUSD && transaction.orderType == OrderType.STOP_LOSS) {
            errorMessage = "⚠️ Stop Loss higher than the current price. Did you mean setting up limit order instead ? If not, please set a lower sell value and try again. \n";
        }

        if (triggerPrice < sellTokenPriceInUSD && transaction.orderType == OrderType.LIMIT_ORDER_SELL) {
            errorMessage = "⚠️ Limit Sell order price is lower than current price. Did you mean setting up stop loss instead ? If not, please set a higher sell value and try again. \n";
        }
    } else if (transaction.triggerType == TriggerType.PERCENTAGE) {
        if (triggerPrice > 100 && transaction.orderType == OrderType.STOP_LOSS) {
            errorMessage = "⚠️ Stop Loss higher than the current price. Did you mean setting up limit order instead? If not, please set a lower sell value and try again. \n";
        }

        if (triggerPrice < 0 && (transaction.orderType == OrderType.LIMIT_ORDER_SELL || transaction.orderType == OrderType.LIMIT_ORDER_BUY)) {
            errorMessage = "⚠️ Limit Sell order price is lower than current price. Please set a higher value and try again.\n";
        }
    } else if (transaction.triggerType == TriggerType.VALUE_PRICE_DROP || transaction.triggerType == TriggerType.VALUE_PRICE_INCREASE) {
        let stopLossPrice = sellTokenPriceInUSD - Number(transaction.triggerPrice);
        let limitOrderPrice = sellTokenPriceInUSD + Number(transaction.triggerPrice);

        if (stopLossPrice <= 0 && transaction.orderType == OrderType.STOP_LOSS) {
            errorMessage = "⚠️ Stop Loss higher than the current price. Please set a lower value and try again. \n";
        }

        if (limitOrderPrice < sellTokenPriceInUSD && transaction.orderType == OrderType.LIMIT_ORDER_SELL) {
            errorMessage = "⚠️ Limit Sell order price is lower than current price. Did you mean setting up stop loss instead? If not, please set a higher sell value and try again. \n";
        }
    }

    if (errorMessage) {
        elizaLogger.error(
            traceId,
            `[senpiOrders] [${moxieUserId}] [handleSellOrder] ${errorMessage}`
        );
    }

    return errorMessage;
}