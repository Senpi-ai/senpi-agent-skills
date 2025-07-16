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
import { ActionType, CreateManualOrderInput, OpenOrderInput, OrderTriggerType, OrderType, RequestType, SenpiOrdersResponse, Source, SwapInput } from "../types";

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

            // read moxieUserInfo from state
            const agentWallet = state.agentWallet as MoxieClientWallet;

            if (!agentWallet) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] agentWallet not found`
                );
                await callback?.(agentWalletNotFound);
                return true;
            }

            if (!agentWallet.delegated) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] agentWallet is not delegated`
                );
                await callback?.(delegateAccessNotFound);
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


            // Compose swap context
            const senpiOrdersContext = composeContext({
                state,
                template: senpiOrdersTemplate,
            });

            // Generate swap content
            const senpiOrders = (await generateObjectDeprecated({
                runtime,
                context: senpiOrdersContext,
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
                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] swapOptions: ${JSON.stringify(senpiOrders)}`
            );

            // check if there is any error in the swapOptions
            if (senpiOrders.error) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] senpiOrders has error: ${JSON.stringify(senpiOrders)}`
                );
                await callback?.({
                    text: senpiOrders.error?.error?.prompt_message || "Something went wrong. Please try again.",
                    content: {
                        action: "SENPI_ORDERS",
                        inReplyTo: _message.id,
                    },
                });
                return true;
            }

            // Validate Senpi orders
            if (
                !validateSenpiOrders(traceId, moxieUserId, senpiOrders, callback)
            ) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] senpiOrders is not valid: ${JSON.stringify(senpiOrders)}`
                );
                return true;
            }

            const action = senpiOrders.action;

            elizaLogger.debug(
                traceId,
                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] action: ${action}`
            );

            const groupedTransactions: Map<string, any[]> = new Map();

            /**
             * Group transactions by token address
             */
            for (const transaction of senpiOrders.transactions) {
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
                            `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Unknown order type: ${transaction.orderType}`
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
                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] groupedTransactions: ${JSON.stringify(Array.from(groupedTransactions.entries()))}`
            );

            /**
             * Process each transaction
             */
            const currentWalletBalanceForBalanceBasedSwaps: Map<
                string,
                bigint | undefined
            > = new Map();

            for (const [tokenAddress, transactions] of groupedTransactions.entries()) {
                elizaLogger.debug(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Processing transactions for tokenAddress: ${tokenAddress}`
                );

                await callback?.({
                    text: `Preparing order parameters for token: ${tokenAddress}`,
                    content: {
                        action: "SENPI_ORDERS",
                        inReplyTo: _message.id,
                    },
                });

                let swapInput: SwapInput | undefined;
                let stopLossInput: OpenOrderInput[] = [];
                let limitOrderInput: OpenOrderInput[] = [];

                for (const transaction of transactions) {
                    // Process each transaction
                    elizaLogger.debug(
                        traceId,
                        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Processing transaction: ${JSON.stringify(transaction)}`
                    );

                    let { sellToken, buyToken, sellQuantity, buyQuantity, valueType, orderType, orderScope, executionType, triggerType, triggerPrice, balance } = transaction;

                    // The LLM can sometimes send negative trigger percentage and trigger price. We need to make them positive.
                    if (triggerPrice) {
                        triggerPrice = Math.abs(triggerPrice);
                    }

                    if (balance && balance.value) {
                        balance.value = Math.abs(balance.value);
                    }

                    const {
                        extractedSellTokenSymbol,
                        extractedSellTokenAddress,
                        extractedSellTokenDecimals,
                        extractedBuyTokenSymbol,
                        extractedBuyTokenAddress,
                        extractedBuyTokenDecimals,
                    } = await extractTokenDetailsAndDecimalsWithCache(
                        sellToken,
                        buyToken,
                        traceId,
                        moxieUserId,
                        tokenAddressToSymbol,
                        tokenAddressToDecimals
                    );

                    let hasSellOrder = false;
                    let hasBuyOrder = false;

                    if  (orderType == "BUY" || orderType == "SELL") {
                        if (hasSellOrder && orderType == "BUY") {
                            elizaLogger.error(
                                traceId,
                                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] A buy and sell order cannot exist for the same token simultaneously.`
                            );
                            await callback?.({
                                text: "A buy and sell order cannot exist for the same token simultaneously.",
                                content: {
                                    action: "SENPI_ORDERS",
                                    inReplyTo: _message.id,
                                },
                            });
                            return true;
                        }
                        
                        if (hasBuyOrder && hasSellOrder) {
                            elizaLogger.error(
                                traceId,
                                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] A buy and sell order cannot exist for the same token simultaneously.`
                            );
                            await callback?.({
                                text: "A buy and sell order cannot exist for the same token simultaneously.",
                                content: {
                                    action: "SENPI_ORDERS",
                                    inReplyTo: _message.id,
                                },
                            });
                        }   
                        if (orderType == "BUY") {
                            hasBuyOrder = true;
                        } else {
                            hasSellOrder = true;
                        }

                        /**
                         * Basically there are 4 cases here.
                         * 1. buyQuantity is available
                         * 2. buyQuantity is not available and balance is available, with quantity
                         * 3. buyQuantity is not available and balance is available, with percentage
                         * 4. buyQuantity is not available and balance is not available with full balance
                         * 
                         * Similar cases for sell type.
                         **/

                        if (buyQuantity) {
                            let buyQuantityInWEI = ethers.parseUnits(
                                buyQuantity.toString(),
                                extractedBuyTokenDecimals
                            );

                            if (valueType && valueType == "USD") {  
                                buyQuantityInWEI = ethers.parseUnits(buyQuantity.toString(), extractedBuyTokenDecimals);
                            }

                            elizaLogger.debug(
                                traceId,
                                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] buyQuantityInWEI: ${buyQuantityInWEI} | extractedBuyTokenDecimals: ${extractedBuyTokenDecimals} | buyQuantity: ${buyQuantity} | valueType: ${valueType}`
                            );

                            try {
                                if (extractedSellTokenSymbol != "USDC") {
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
                                        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] price from getUSDEquivalentPrice: ${price}`
                                    );
                                    buyQuantityInWEI = BigInt(price);

                                    elizaLogger.debug(
                                        traceId,
                                        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] buyQuantityInWEI: ${buyQuantityInWEI}`
                                    );

                                    if (extractedBuyTokenSymbol != extractedSellTokenSymbol) {
                                        swapInput = {
                                            sellTokenAddress: extractedSellTokenAddress,
                                            buyTokenAddress: extractedBuyTokenAddress,
                                            amount: buyQuantityInWEI.toString(),
                                            chainId: 8453,
                                            sellTokenSymbol: extractedSellTokenSymbol,
                                            buyTokenSymbol: extractedBuyTokenSymbol,
                                            sellTokenDecimal: extractedSellTokenDecimals,
                                            buyTokenDecimal: extractedBuyTokenDecimals,
                                        };
                                    }
                                } else {
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
                                        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] price: ${price}`
                                    );

                                    buyQuantityInWEI = BigInt(price);

                                    const currentSellTokenBalanceInWEI =
                                        extractedSellTokenSymbol == "ETH"
                                            ? await getNativeTokenBalance(
                                                traceId,
                                                agentWallet.address
                                            )
                                            : await getERC20Balance(
                                                traceId,
                                                extractedSellTokenAddress,
                                                agentWallet.address
                                            );

                                    elizaLogger.debug(
                                        traceId,
                                        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] currentSellTokenBalanceInWEI: ${currentSellTokenBalanceInWEI}`
                                    );

                                    if (
                                        BigInt(currentSellTokenBalanceInWEI) <
                                        buyQuantityInWEI
                                    ) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] insufficient balance: ${currentSellTokenBalanceInWEI} < ${Number(price)}`
                                        );

                                        await handleInsufficientBalance(
                                            traceId,
                                            state.agentWalletBalance,
                                            moxieUserId,
                                            extractedSellTokenAddress,
                                            extractedSellTokenSymbol,
                                            BigInt(price),
                                            BigInt(currentSellTokenBalanceInWEI),
                                            extractedSellTokenDecimals,
                                            agentWallet.address,
                                            callback,
                                            extractedBuyTokenAddress
                                        );
                                        return true;
                                    }

                                    swapInput = {
                                        sellTokenAddress: extractedSellTokenAddress,
                                        buyTokenAddress: extractedBuyTokenAddress,
                                        amount: buyQuantityInWEI.toString(),
                                        chainId: 8453,
                                        sellTokenSymbol: extractedSellTokenSymbol,
                                        buyTokenSymbol: extractedBuyTokenSymbol,
                                        sellTokenDecimal: extractedSellTokenDecimals,
                                        buyTokenDecimal: extractedBuyTokenDecimals,
                                    }
                                }
                            } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] error: ${error}`
                                    );
                                }
                        } else if (sellQuantity) {

                            let sellQuantityInWEI = ethers.parseUnits(
                                sellQuantity.toString(),
                                extractedSellTokenDecimals
                            );
                            
                            if (valueType && valueType == "USD" && extractedSellTokenAddress != USDC_ADDRESS) {
                                const sellQuantityInUSDWEI = ethers.parseUnits(sellQuantity.toString(), USDC_TOKEN_DECIMALS);

                                // use codex to get the price
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
                                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [SELL_QUANTITY] [USD_VALUE_TYPE] sellQuantityInWEI: ${sellQuantityInWEI}`
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
                                        text: `\nInsufficient ${extractedSellTokenSymbol} balance\n\nCurrent balance: ${ethers.formatUnits(currentSellTokenBalanceInWEI, extractedSellTokenDecimals)} ${extractedSellTokenSymbol}\nRequired amount: ${ethers.formatUnits(sellQuantityInWEI, extractedSellTokenDecimals)} ${extractedSellTokenSymbol}\n\nPlease add ${ethers.formatUnits(sellQuantityInWEI - BigInt(currentSellTokenBalanceInWEI), extractedSellTokenDecimals)} ${extractedSellTokenSymbol} to continue.`,
                                    });
                                    return true;
                                }

                                swapInput = {
                                    sellTokenAddress: extractedSellTokenAddress,
                                    buyTokenAddress: extractedBuyTokenAddress,
                                    amount: sellQuantityInWEI.toString(),
                                    chainId: 8453,
                                    sellTokenSymbol: extractedSellTokenSymbol,
                                    buyTokenSymbol: extractedBuyTokenSymbol,
                                    sellTokenDecimal: extractedSellTokenDecimals,
                                    buyTokenDecimal: extractedBuyTokenDecimals,
                                }
                            } else {
                                swapInput = {
                                    sellTokenAddress: extractedSellTokenAddress,
                                    buyTokenAddress: extractedBuyTokenAddress,
                                    amount: sellQuantityInWEI.toString(),
                                    chainId: 8453,
                                    sellTokenSymbol: extractedSellTokenSymbol,
                                    buyTokenSymbol: extractedBuyTokenSymbol,
                                    sellTokenDecimal: extractedSellTokenDecimals,
                                    buyTokenDecimal: extractedBuyTokenDecimals,
                                }
                            }
                            
                        } else if (balance && balance.type && balance.value) {
                            try {
                                const result =
                                    await getTargetQuantityForBalanceBasedSwaps(
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
                                const quantityInWEI = result.quantityInWEI;
                                currentWalletBalanceForBalanceBasedSwaps[
                                    extractedSellTokenAddress
                                ] = result.currentWalletBalance;

                                
                                elizaLogger.debug(
                                    traceId,
                                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [BALANCE_BASED] quantityInWEI: ${quantityInWEI}`
                                );

                                swapInput = {
                                    sellTokenAddress: extractedSellTokenAddress,
                                    buyTokenAddress: extractedBuyTokenAddress,
                                    amount: quantityInWEI.toString(),
                                    chainId: 8453,
                                    sellTokenSymbol: extractedSellTokenSymbol,
                                    buyTokenSymbol: extractedBuyTokenSymbol,
                                    sellTokenDecimal: extractedSellTokenDecimals,
                                    buyTokenDecimal: extractedBuyTokenDecimals,
                                }
                            } catch (error) {
                                elizaLogger.error(
                                    traceId,
                                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [SWAP] [TOKEN_TO_TOKEN] [BALANCE_BASED] Error getting balance based quantity: ${error}`
                                );
                                return true;
                            } 
                        } else {
                            elizaLogger.error(
                                traceId,
                                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Invalid swap inputs for the token: ${tokenAddress}`
                            );
                            await callback?.({
                                text: `Invalid swap inputs for the token $[${extractedBuyTokenSymbol}|${extractedBuyTokenAddress}]. Please try again.`,
                            });
                        }
                    
                    
                    } else if (transaction.orderType == "STOP_LOSS" || transaction.orderType == "LIMIT_ORDER_SELL" || transaction.orderType == "LIMIT_ORDER_BUY") {

                        if (!triggerType || !triggerPrice || !balance || !balance.type || !balance.value) {
                            elizaLogger.error(
                                traceId,
                                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Missing trigger type or trigger price or balance for stop loss order: ${JSON.stringify(transaction)}`
                            );
                            await callback?.({
                                text: "Missing trigger type or trigger price for stop loss order.",
                                content: {
                                    action: "SENPI_ORDERS",
                                    inReplyTo: _message.id,
                                },
                            });
                            return true;
                        }   

                        if (extractedSellTokenSymbol && extractedSellTokenSymbol === "ETH") {
                            // can't place a stop loss order for ETH
                            elizaLogger.error(
                                traceId,
                                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Can't place a stop loss/ limit order for ETH`
                            );
                            await callback?.({
                                text: "Can't place a stop loss/ limit order for ETH",
                            });
                            return true;
                        }

                        // fetch the current price of the token
                        const sellTokenPriceInUSD = tokenAddressToPrice.get(extractedSellTokenAddress);
                        if (!sellTokenPriceInUSD) {
                            const price = await getUSDPrice(traceId, moxieUserId, extractedSellTokenAddress);
                            tokenAddressToPrice.set(extractedSellTokenAddress, Number(price));
                        }
                        
                        // fetch the agent wallet balance of the token
                        const key = `${agentWallet.address}-${extractedSellTokenAddress}`;
                        const tokenBalance = walletAddressToTokenAddressToBalance.get(key);
                        if (!tokenBalance) {
                            if (extractedSellTokenSymbol && extractedSellTokenSymbol === "ETH") {
                                const tokenBalance = await getNativeTokenBalance(traceId, agentWallet.address);
                                walletAddressToTokenAddressToBalance.set(key, BigInt(tokenBalance));
                            } else {
                                const tokenBalance = await getERC20Balance(traceId, agentWallet.address, extractedSellTokenAddress);
                                walletAddressToTokenAddressToBalance.set(key, BigInt(tokenBalance));
                            }
                        }

                        // some validations on price. i.e. if absolute price is more than sellTokenPriceInUSD, then it is not a valid stop loss order.
                        // Also, if the price drop brings the stop loss price below 0, then it is not a valid stop loss order. These are the cases where triggerType is "ABSOLUTE" and triggerPrice is more than sellTokenPriceInUSD.
                        if (triggerType == "ABSOLUTE") {

                            let errorMessage = "";
                            if (transaction.orderType == "STOP_LOSS" && triggerPrice > sellTokenPriceInUSD) {
                                errorMessage = "Stop loss price is not valid. Current price is less than the stop loss price.";
                            } 
                            
                            if (transaction.orderType == "LIMIT_ORDER_SELL" && triggerPrice < sellTokenPriceInUSD) {
                                errorMessage = "Limit order price is not valid. Current price is more than the limit order price.";
                            }

                            if (errorMessage) {
                                elizaLogger.error(  
                                    traceId,
                                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] ${errorMessage}`
                                );
                            }
                            await callback?.({
                                text: errorMessage,
                            });
                            return true;
                        }   

                        if (triggerType === "PRICE_DROP" || triggerType === "PRICE_INCREASE") {

                            let errorMessage = "";

                            let stopLossPrice = sellTokenPriceInUSD - triggerPrice;
                            let limitOrderPrice = sellTokenPriceInUSD + triggerPrice;

                            if (transaction.orderType == "STOP_LOSS" && stopLossPrice <= 0) {
                                errorMessage = "Stop loss price is not valid. Price drop is bringing the stop loss price below 0.";
                            } 
                            
                            if (transaction.orderType == "LIMIT_ORDER_SELL" && limitOrderPrice < sellTokenPriceInUSD) {
                                errorMessage = "Limit order price is not valid. Limit order price is below the current price.";
                            }

                            if (errorMessage) {
                                elizaLogger.error(
                                    traceId,
                                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] ${errorMessage}`
                                );
                            }
                            await callback?.({
                                text: errorMessage,
                            });
                            return true;
                        }   

                        let orderTriggerType: OrderTriggerType;
                        let orderTriggerValue: string;

                        if (triggerType === "ABSOLUTE" || triggerType === "PRICE_DROP" || triggerType === "PRICE_INCREASE") {
                            orderTriggerType = OrderTriggerType.TOKEN_PRICE;
                            if (triggerType === "ABSOLUTE") {
                                orderTriggerValue = triggerPrice.toString();
                            } else if (triggerType === "PRICE_DROP") {
                                orderTriggerValue = (sellTokenPriceInUSD - triggerPrice).toString();
                            } else if (triggerType === "PRICE_INCREASE") {
                                orderTriggerValue = (sellTokenPriceInUSD + triggerPrice).toString();
                            }
                        } else if (triggerType === "PERCENTAGE") {
                            orderTriggerType = OrderTriggerType.PERCENTAGE;
                            orderTriggerValue = triggerPrice.toString();
                        } else {
                            elizaLogger.error(
                                traceId,
                                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Invalid trigger type: ${triggerType}`
                            );
                            await callback?.({
                                text: "Invalid trigger type for stop loss order. Please try again.",
                            });
                        }

                        if (action == ActionType.SL || action == ActionType.SL_LO || action == ActionType.LO) {
                            // create a stop loss order

                            if (balance && (balance.type == "FULL" || balance.type == "PERCENTAGE")) {

                                if (balance.type == "FULL") {
                                    balance.value = 100;
                                }

                                if (transaction.orderType == "LIMIT_ORDER_BUY") {
                                    let buyAmountInWEI = ethers.parseUnits(balance.value.toString(), extractedBuyTokenDecimals);

                                    const openOrderInput: OpenOrderInput = {
                                        buyAmountInWei: buyAmountInWEI.toString(),
                                        buyAmount: balance.value.toString(),
                                        sellTokenAddress: extractedSellTokenAddress,
                                        sellTokenSymbol: extractedSellTokenSymbol,
                                        sellTokenDecimals: extractedSellTokenDecimals,
                                        buyTokenAddress: extractedBuyTokenAddress,
                                        buyTokenSymbol: extractedBuyTokenSymbol,
                                        buyTokenDecimals: extractedBuyTokenDecimals,    
                                        triggerValue: orderTriggerValue,
                                        triggerType: orderTriggerType,
                                        requestType: RequestType.LIMIT_ORDER,
                                        chainId: 8453,
                                    }

                                    limitOrderInput.push(openOrderInput);

                                    // buy token balance
                                } else {
                                    let sellTokenBalanceInWEIBigInt = BigInt(tokenBalance);
                                    const quantityPercentageValue = parseFloat(balance.value)/100;
                                    sellTokenBalanceInWEIBigInt = applyPercentage(sellTokenBalanceInWEIBigInt, quantityPercentageValue);
                                    const sellTokenBalanceInWEI = sellTokenBalanceInWEIBigInt.toString();
                                    const sellTokenBalance = ethers.formatUnits(sellTokenBalanceInWEI, extractedSellTokenDecimals);

                                    const openOrderInput: OpenOrderInput = {
                                        sellAmountInWei: sellTokenBalanceInWEI.toString(),
                                        sellAmount: sellTokenBalance.toString(),
                                        sellTokenAddress: extractedSellTokenAddress,
                                        sellTokenSymbol: extractedSellTokenSymbol,
                                        sellTokenDecimals: extractedSellTokenDecimals,
                                        buyTokenAddress: extractedBuyTokenAddress,
                                        buyTokenSymbol: extractedBuyTokenSymbol,
                                        buyTokenDecimals: extractedBuyTokenDecimals,    
                                        triggerValue: orderTriggerValue,
                                        triggerType: orderTriggerType,
                                        requestType: transaction.orderType == "STOP_LOSS" ? RequestType.STOP_LOSS : RequestType.LIMIT_ORDER,
                                        chainId: 8453,
                                    }
                                    if (transaction.orderType == "STOP_LOSS") {
                                        stopLossInput.push(openOrderInput);
                                    } else {
                                        limitOrderInput.push(openOrderInput);
                                    }
                                }

                                
                            } else if (balance.type == "QUANTITY") {

                                if (transaction.orderType == "LIMIT_ORDER_BUY") {
                                    const buyAmountInWei = ethers.parseUnits(balance.value.toString(), extractedBuyTokenDecimals);

                                    const openOrderInput: OpenOrderInput = {
                                        buyAmountInWei: buyAmountInWei.toString(),
                                        buyAmount: balance.value.toString(),
                                        sellTokenAddress: extractedSellTokenAddress,
                                        sellTokenSymbol: extractedSellTokenSymbol,
                                        sellTokenDecimals: extractedSellTokenDecimals,
                                        buyTokenAddress: extractedBuyTokenAddress,
                                        buyTokenSymbol: extractedBuyTokenSymbol,
                                        buyTokenDecimals: extractedBuyTokenDecimals,    
                                        triggerValue: orderTriggerValue,
                                        triggerType: orderTriggerType,
                                        requestType: RequestType.LIMIT_ORDER,
                                        chainId: 8453,
                                    }

                                    limitOrderInput.push(openOrderInput);

                                    // buy token balance
                                } else {
                                    let sellTokenBalanceInWEIBigInt = BigInt(tokenBalance);
                                    const quantityPercentageValue = parseFloat(balance.value)/100;
                                    sellTokenBalanceInWEIBigInt = applyPercentage(sellTokenBalanceInWEIBigInt, quantityPercentageValue);
                                    const sellTokenBalanceInWEI = sellTokenBalanceInWEIBigInt.toString();
                                    const sellTokenBalance = ethers.formatUnits(sellTokenBalanceInWEI, extractedSellTokenDecimals);

                                    const openOrderInput: OpenOrderInput = {
                                        sellAmountInWei: sellTokenBalanceInWEI.toString(),
                                        sellAmount: sellTokenBalance.toString(),
                                        sellTokenAddress: extractedSellTokenAddress,
                                        sellTokenSymbol: extractedSellTokenSymbol,
                                        sellTokenDecimals: extractedSellTokenDecimals,
                                        buyTokenAddress: extractedBuyTokenAddress,
                                        buyTokenSymbol: extractedBuyTokenSymbol,
                                        buyTokenDecimals: extractedBuyTokenDecimals,    
                                        triggerValue: orderTriggerValue,
                                        triggerType: orderTriggerType,
                                        requestType: transaction.orderType == "STOP_LOSS" ? RequestType.STOP_LOSS : RequestType.LIMIT_ORDER,
                                        chainId: 8453,
                                    }
                                    if (transaction.orderType == "STOP_LOSS") {
                                        stopLossInput.push(openOrderInput);
                                    } else {
                                        limitOrderInput.push(openOrderInput);
                                    }
                                }
                                
                            } else {
                                elizaLogger.error(
                                    traceId,
                                    `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Balance type is not valid: ${balance.type}`
                                );
                                await callback?.({
                                    text: "Invalid balance type for stop loss order. Please try again.",
                                    content: {
                                        action: "SENPI_ORDERS",
                                        inReplyTo: _message.id,
                                    },
                                });
                                return true;
                            }
                        } else {

                            const openOrderInput: OpenOrderInput = {
                                sellTokenAddress: extractedSellTokenAddress,
                                sellTokenSymbol: extractedSellTokenSymbol,
                                sellTokenDecimals: extractedSellTokenDecimals,
                                buyTokenAddress: extractedBuyTokenAddress,
                                buyTokenSymbol: extractedBuyTokenSymbol,
                                buyTokenDecimals: extractedBuyTokenDecimals,    
                                triggerValue: orderTriggerValue,
                                triggerType: orderTriggerType,
                                requestType: transaction.orderType == "STOP_LOSS" ? RequestType.STOP_LOSS : RequestType.LIMIT_ORDER,
                                chainId: 8453,
                            }

                            if (orderTriggerType === OrderTriggerType.PERCENTAGE) {
                                openOrderInput.sellPercentage = orderTriggerValue;
                            } else {
                                openOrderInput.sellAmount = orderTriggerValue;
                            }

                            stopLossInput.push(openOrderInput);
                        }

                    } else {
                        elizaLogger.warn(
                            traceId,
                            `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] Unknown order type: ${transaction.orderType}`
                        );
    
                        await callback?.({
                            text: senpiOrders.error?.error?.prompt_message || "Something went wrong. Please try again.",
                            content: {
                                action: "SENPI_ORDERS",
                                inReplyTo: _message.id,
                            },
                        });
                        return true;
                    }
                }

                if (swapInput || stopLossInput.length > 0 || limitOrderInput.length > 0) {
                    await callback?.({
                        text: "I'm creating the orders for you. Please wait for a moment.",
                        content: {
                            action: "SENPI_ORDERS",
                            inReplyTo: _message.id,
                        },
                    });

                    const result = await createManualOrder(state.authorizationHeader as string, action, Source.AGENT, swapInput, stopLossInput, limitOrderInput);
                    if (!result.success) {
                        const errorMessage = result.error || "Something went wrong. Please try again.";
                        await callback?.({
                            text: `I've failed to create the orders for you. ${errorMessage}`,
                            content: {
                                action: "SENPI_ORDERS",
                                inReplyTo: _message.id,
                            },
                        });
                    }

                    // check if swapOutput is not empty and use it to send a response
                    if (result.success && result.metadata?.swapOutput) {
                        const swapOutput = result.metadata.swapOutput;
                        const message = `Swap order successfully created for token ${tokenAddress}\n` +
                                        `| TxHash | Buy Amount | Sell Amount \n` +
                                        `|----------|--------------|---------------|\n` +
                                        `| ${swapOutput.txHash} | ${swapOutput.buyAmountInUSD} | ${swapOutput.sellAmountInUSD} |\n`;

                        await callback?.({
                            text: message,
                            content: {
                                action: "SENPI_ORDERS",
                                inReplyTo: _message.id,
                            },
                        });
                    }

                    if (result.success && result.metadata?.stopLossOutputs) {
                        const stopLossOutputs = result.metadata.stopLossOutputs;
                        let message = `Stop loss order successfully created for token ${tokenAddress}\n` +
                                      `| Order ID | Stop Loss Price | Sell Amount | Trigger Type | Trigger Value   |\n` +
                                      `|----------|----------------|-------------|--------------|-----------------|\n`;
                        stopLossOutputs.forEach(output => {
                            message += `| ${output.subscriptionId} | ${output.stopLossPrice} | ${output.sellAmount} | ${output.triggerType} | ${output.triggerValue} |\n`;
                        });
                        await callback?.({
                            text: message,
                            content: {
                                action: "SENPI_ORDERS",
                                inReplyTo: _message.id,
                            },
                        });
                    }

                    if (result.success && result.metadata?.limitOrderOutputs) {
                        const limitOrderOutputs = result.metadata.limitOrderOutputs;
                        let message = `Limit order successfully created for token ${tokenAddress}\n` +
                                      `| Order ID | Limit Price | Buy Amount | Sell Amount | Trigger Type | Trigger Value   |\n` +
                                      `|----------|-------------|------------|-------------|--------------|-----------------|\n`;
                        limitOrderOutputs.forEach(output => {
                            message += `| ${output.limitOrderId} | ${output.limitPrice} | ${output.buyAmount} | ${output.sellAmount} | ${output.triggerType} | ${output.triggerValue} |\n`;
                        });
                        await callback?.({
                            text: message,
                            content: {
                                action: "SENPI_ORDERS",
                                inReplyTo: _message.id,
                            },
                        });
                    }
                }  
            }

            // delete the cache
            const cacheKey = `PORTFOLIO-V2-${moxieUserId}`;
            await runtime.cacheManager.delete(cacheKey);
            elizaLogger.debug(
                traceId,
                `[senpiOrders] [${moxieUserId}] [senpiOrdersAction] [CACHE] deleted cache key: ${cacheKey}`
            );

        } catch (error) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] error occured while performing swap operation: ${JSON.stringify(error)}`
            );
            if (
                error.message ==
                "Wallet has insufficient funds to execute the transaction (transaction amount + fees)"
            ) {
                await callback?.(insufficientEthBalanceTemplate);
            }
            else {
                await callback?.(swapOperationFailedTemplate(error));
            }
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
            text: "\nAn error occurred while processing your request. Please try again.",
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
        if (!transaction.balance) missingFields.push("balance");

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
                text: "\nAn error occurred while processing your request. Please try again.",
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
                text: "\nTransaction quantities must be greater than 0.",
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
                (transaction.balance.type === "PERCENTAGE" &&
                    (transaction.balance.value <= 0 ||
                        (transaction.balance.value > 100 && transaction.orderType !== OrderType.LIMIT_ORDER_SELL)))
            ) {
                elizaLogger.error(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] [validateSenpiOrders] Invalid balance configuration: ${JSON.stringify(transaction.balance)}`
                );
                await callback?.({
                    text: "\nAn error occurred while processing your request. Please try again.",
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

    await callback?.({
        text:
            otherTokensWithSufficientBalance.length === 0
                ? `\nInsufficient ${sellTokenSymbol} balance to complete this transaction. \n Current balance: ${ethers.formatUnits(tokenBalance, sellTokenDecimals)} ${sellTokenSymbol} \n Required balance: ${ethers.formatUnits(sellAmountInWEI, sellTokenDecimals)} ${sellTokenSymbol} \n\nPlease add more ${sellTokenSymbol} funds to your agent wallet to complete this transaction.`
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
    });
}


/**
 * Get the current wallet balance
 * @param moxieUserId The user ID of the person performing the swap
 * @param sellToken The token to sell
 * @param agentWallet The wallet address to receive the tokens
 * @param balance The balance object
 * @param callback The callback function to receive status updates
 * @returns Promise that resolves to the quantity required in WEI
 */
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
            text: `\nYour agent wallet doesn't have any ${sellTokenSymbol} balance to complete this operation.`,
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

/**
 * Extracts token details and decimals with caching
 * @param sellToken - The token to sell
 * @param buyToken - The token to buy
 * @param traceId - The trace ID for logging
 * @param moxieUserId - The user ID of the person performing the swap
 * @param tokenAddressToSymbol - A map of token addresses to their symbols
 * @param tokenAddressToDecimals - A map of token addresses to their decimals
 * @returns An object containing the extracted token details and decimals, as well as the updated maps
 */
export async function extractTokenDetailsAndDecimalsWithCache(
    sellToken: string,
    buyToken: string,
    traceId: string,
    moxieUserId: string,
    tokenAddressToSymbol: Map<string, string>,
    tokenAddressToDecimals: Map<string, number>
) {
    let extractedSellTokenSymbol, extractedSellTokenAddress, extractedSellTokenDecimals;
    let extractedBuyTokenSymbol, extractedBuyTokenAddress, extractedBuyTokenDecimals;

    if (ethers.isAddress(sellToken)) {
        extractedSellTokenAddress = sellToken;
        if (!tokenAddressToSymbol.has(sellToken)) {
            try {
                extractedSellTokenSymbol = await getERC20TokenSymbol(sellToken);
                tokenAddressToSymbol.set(sellToken, extractedSellTokenSymbol); // Cache the result
            } catch (error) {
                elizaLogger.warn(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] Failed to fetch sell token symbol from RPC: ${error}`
                );
            }
        } else {
            extractedSellTokenSymbol = tokenAddressToSymbol.get(sellToken)!; // Use cached value
        }
    } else {
        const extracted = extractTokenDetails(sellToken);
        extractedSellTokenSymbol = extracted.tokenSymbol;
        extractedSellTokenAddress = extracted.tokenAddress;
    }

    if (ethers.isAddress(buyToken)) {
        extractedBuyTokenAddress = buyToken;
        if (!tokenAddressToSymbol.has(buyToken)) {
            try {
                extractedBuyTokenSymbol = await getERC20TokenSymbol(buyToken);
                tokenAddressToSymbol.set(buyToken, extractedBuyTokenSymbol); // Cache the result
            } catch (error) {
                elizaLogger.warn(
                    traceId,
                    `[senpiOrders] [${moxieUserId}] Failed to fetch buy token symbol from RPC: ${error}`
                );
            }
        } else {
            extractedBuyTokenSymbol = tokenAddressToSymbol.get(buyToken)!; // Use cached value
        }
    } else {
        const extracted = extractTokenDetails(buyToken);
        extractedBuyTokenAddress = extracted.tokenAddress;
    }

    if (extractedSellTokenSymbol == "ETH") {
        extractedSellTokenDecimals = 18;
    } else if (extractedSellTokenSymbol == "USDC") {
        extractedSellTokenDecimals = USDC_TOKEN_DECIMALS;
    } else {
        if (!tokenAddressToDecimals.has(extractedSellTokenAddress)) {
            extractedSellTokenDecimals = await getERC20Decimals(traceId, extractedSellTokenAddress);
            tokenAddressToDecimals.set(extractedSellTokenAddress, extractedSellTokenDecimals); // Cache the result
        } else {
            extractedSellTokenDecimals = tokenAddressToDecimals.get(extractedSellTokenAddress)!; // Use cached value
        }
    }

    if (extractedBuyTokenSymbol == "ETH") {
        extractedBuyTokenDecimals = 18;
    } else if (extractedBuyTokenSymbol == "USDC") {
        extractedBuyTokenDecimals = USDC_TOKEN_DECIMALS;
    } else {
        if (!tokenAddressToDecimals.has(extractedBuyTokenAddress)) {
            extractedBuyTokenDecimals = await getERC20Decimals(traceId, extractedBuyTokenAddress);
            tokenAddressToDecimals.set(extractedBuyTokenAddress, extractedBuyTokenDecimals); // Cache the result
        } else {
            extractedBuyTokenDecimals = tokenAddressToDecimals.get(extractedBuyTokenAddress)!; // Use cached value
        }
    }

    return {
        extractedSellTokenSymbol,
        extractedSellTokenAddress,
        extractedSellTokenDecimals,
        extractedBuyTokenSymbol,
        extractedBuyTokenAddress,
        extractedBuyTokenDecimals,
        tokenAddressToSymbol,
        tokenAddressToDecimals
    };
}