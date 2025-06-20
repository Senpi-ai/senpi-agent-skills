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
    ftaService,
    getERC20TokenSymbol,
    MoxieClientWallet,
    MoxieHex,
    MoxieUser,
    MoxieWalletClient,
    MoxieWalletSendTransactionResponseType,
    MoxieWalletSignTypedDataResponseType,
} from "@moxie-protocol/moxie-agent-lib";
import { tokenSwapTemplate } from "../templates/tokenSwapTemplate";
import {
    decodeTokenTransfer,
    getERC20Balance,
    getERC20Decimals,
    getNativeTokenBalance,
} from "../utils/erc20";
import { executeBuyAction, executeSellAction } from "../utils/swapCreatorCoins";
import { concat, ethers } from "ethers";
import { execute0xSwap, get0xSwapQuote } from "../utils/0xApis";
import {
    extractCreatorDetails,
    extractTokenDetails,
    handleTransactionStatus,
} from "../utils/common";
import { checkAllowanceAndApproveSpendRequest } from "../utils/checkAndApproveTransaction";
import { numberToHex, size } from "viem";
import { tokenSwapExamples } from "./examples";
import {
    ETH_ADDRESS,
    MOXIE,
    MOXIE_TOKEN_ADDRESS,
    MOXIE_TOKEN_DECIMALS,
    USDC,
    USDC_ADDRESS,
    USDC_TOKEN_DECIMALS,
    WETH_ADDRESS,
} from "../utils/constants";
import { calculateTokensBuy } from "../utils/moxieBondingCurve";
import {
    initiatePurchaseTemplate,
    insufficientEthBalanceTemplate,
    swapInProgressTemplate,
    swapOperationFailedTemplate,
    swapCompletedTemplate,
    swapFailedTemplate,
    agentWalletNotFound,
    delegateAccessNotFound,
    moxieWalletClientNotFound,
} from "../utils/callbackTemplates";
import {
    getSubjectTokenDetailsBySubjectAddress,
    getSubjectTokenDetailsBySubjectTokenAddresses,
    SubjectToken,
} from "../utils/subgraph";
import Decimal from "decimal.js";
import { getPrice } from "../utils/codexApis";
import { GetQuoteResponse } from "../types";

export const tokenSwapAction = {
    suppressInitialMessage: true,
    name: "SWAP_TOKENS",
    description:
        "This action handles all creator coin transactions and erc20 token transactions, setting specific allocation ratios (e.g. 30-70 split), bulk token purchases using @ mentions, general buying/selling/swapping of creator coins, and ERC20 token swaps between tokens starting with $[. Use for any message containing purchase amounts ($10, etc) with coin symbols, @ mentions, or ERC20 token symbols in the user message or message history. This will only work for market price orders.",
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
        try {
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] Starting creatorCoinSwap handler with user message: ${JSON.stringify(_message, (key, value) => (key === "embedding" ? undefined : value))}`
            );

            // Compose swap context
            const swapContext = composeContext({
                state,
                template: tokenSwapTemplate,
            });

            // Generate swap content
            const swapOptions = (await generateObjectDeprecated({
                runtime,
                context: swapContext,
                modelClass: ModelClass.LARGE,
                modelConfigOptions: {
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                    modelProvider: ModelProviderName.ANTHROPIC,
                    apiKey: process.env.ANTHROPIC_API_KEY,
                    modelClass: ModelClass.LARGE,
                },
            })) as TokenSwapResponse;

            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] swapOptions: ${JSON.stringify(swapOptions)}`
            );

            // check if confirmation is required
            if (swapOptions.confirmation_required) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] confirmation required: ${swapOptions.confirmation_required}`
                );
                await callback?.({
                    text: swapOptions.confirmation_message,
                    content: {
                        confirmation_required: true,
                        action: "SWAP_TOKENS",
                        inReplyTo: _message.id,
                    },
                });
                return true;
            }

            // check if there is any error in the swapOptions
            if (swapOptions.error) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] swapOptions has error: ${JSON.stringify(swapOptions)}`
                );
                await callback?.({
                    text: swapOptions.error.prompt_message,
                    content: {
                        action: "SWAP_TOKENS",
                        inReplyTo: _message.id,
                    },
                });
                return true;
            }

            // Validate swap content
            if (
                !isValidSwapContent(traceId, moxieUserId, swapOptions, callback)
            ) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] swapOptions is not valid: ${JSON.stringify(swapOptions)}`
                );
                return true;
            }

            // read moxieUserInfo from state
            const agentWallet = state.agentWallet as MoxieClientWallet;

            if (!agentWallet) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] agentWallet not found`
                );
                await callback?.(agentWalletNotFound);
                return true;
            }

            if (!agentWallet.delegated) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] agentWallet is not delegated`
                );
                await callback?.(delegateAccessNotFound);
                return true;
            }

            const walletClient = state.moxieWalletClient as MoxieWalletClient;
            if (!walletClient) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] walletClient not found`
                );
                await callback?.(moxieWalletClientNotFound);
                return true;
            }

            // process each transaction
            const provider = new ethers.JsonRpcProvider(
                process.env.BASE_RPC_URL
            );
            const currentWalletBalanceForBalanceBasedSwaps: Map<
                string,
                bigint | undefined
            > = new Map();
            for (const transaction of swapOptions.transactions) {
                // retrieve transaction elements
                const {
                    sellQuantity,
                    buyQuantity,
                    sellToken,
                    buyToken,
                    value_type,
                    balance,
                } = transaction;
                elizaLogger.debug(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] transaction elements - ${JSON.stringify(transaction)}`
                );

                if (
                    swapOptions.action == "SWAP" ||
                    swapOptions.action == "SELL" ||
                    swapOptions.action == "BUY"
                ) {
                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] starting swap action with sellToken: ${sellToken} and buyToken: ${buyToken} and sellQuantity: ${sellQuantity} and buyQuantity: ${buyQuantity}`
                    );

                    let sellTokenAddress: string;
                    let sellTokenSymbol: string;
                    let buyTokenAddress: string;
                    let buyTokenSymbol: string;

                    // Extract token details and check if raw tokens are Ethereum addresses
                    let extractedSellTokenSymbol, extractedSellTokenAddress;

                    if (ethers.isAddress(sellToken)) {
                        extractedSellTokenAddress = sellToken;
                        try {
                            extractedSellTokenSymbol =
                                await getERC20TokenSymbol(sellToken);
                        } catch (error) {
                            elizaLogger.warn(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] Failed to fetch sell token symbol from RPC: ${error}`
                            );
                        }
                    } else {
                        const extracted = extractTokenDetails(sellToken);
                        extractedSellTokenSymbol = extracted.tokenSymbol;
                        extractedSellTokenAddress = extracted.tokenAddress;
                    }

                    let extractedBuyTokenSymbol, extractedBuyTokenAddress;

                    if (ethers.isAddress(buyToken)) {
                        extractedBuyTokenAddress = buyToken;
                        try {
                            extractedBuyTokenSymbol =
                                await getERC20TokenSymbol(buyToken);
                        } catch (error) {
                            elizaLogger.warn(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] Failed to fetch buy token symbol from RPC: ${error}`
                            );
                        }
                    } else {
                        const extracted = extractTokenDetails(buyToken);
                        extractedBuyTokenSymbol = extracted.tokenSymbol;
                        extractedBuyTokenAddress = extracted.tokenAddress;
                    }

                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] extractedSellTokenSymbol: ${extractedSellTokenSymbol} and extractedSellTokenAddress: ${extractedSellTokenAddress} and extractedBuyTokenSymbol: ${extractedBuyTokenSymbol} and extractedBuyTokenAddress: ${extractedBuyTokenAddress}`
                    );

                    // Extract creator details
                    const {
                        userId: extractedSellTokenCreatorId,
                        username: extractedSellTokenCreatorUsername,
                    } = extractCreatorDetails(sellToken);
                    const {
                        userId: extractedBuyTokenCreatorId,
                        username: extractedBuyTokenCreatorUsername,
                    } = extractCreatorDetails(buyToken);
                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] extractedSellTokenCreatorId: ${extractedSellTokenCreatorId} and extractedSellTokenCreatorUsername: ${extractedSellTokenCreatorUsername} and extractedBuyTokenCreatorId: ${extractedBuyTokenCreatorId} and extractedBuyTokenCreatorUsername: ${extractedBuyTokenCreatorUsername}`
                    );

                    // check if the buy or sell token is a subject token by fetching the subject token details from the subgraph
                    // this check is required if the buy or sell request is coming from other plugins
                    // where users doesn't have moxie user info. they just have  the subject token address
                    const subjectTokenDetails =
                        await getSubjectTokenDetailsBySubjectTokenAddresses(
                            traceId,
                            [
                                extractedSellTokenAddress,
                                extractedBuyTokenAddress,
                            ]
                        );
                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [SUBJECT_TOKEN_CHECK] subjectTokenDetails: ${JSON.stringify(subjectTokenDetails)}`
                    );

                    // Check if sell token is a creator coin
                    const isSellTokenCreatorCoin =
                        subjectTokenDetails?.[extractedSellTokenAddress] &&
                        !subjectTokenDetails[extractedSellTokenAddress]
                            .isGraduated;
                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [SUBJECT_TOKEN_CHECK] isSellTokenCreatorCoin: ${isSellTokenCreatorCoin}`
                    );

                    // Check if buy token is a creator coin
                    const isBuyTokenCreatorCoin =
                        subjectTokenDetails?.[extractedBuyTokenAddress] &&
                        !subjectTokenDetails[extractedBuyTokenAddress]
                            .isGraduated;
                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [SUBJECT_TOKEN_CHECK] isBuyTokenCreatorCoin: ${isBuyTokenCreatorCoin}`
                    );

                    // get the creator coin details
                    const {
                        sellTokenSubjectTokenDetails,
                        buyTokenSubjectTokenDetails,
                    } = await getCreatorCoinDetails(
                        traceId,
                        isSellTokenCreatorCoin,
                        isBuyTokenCreatorCoin,
                        extractedSellTokenAddress,
                        extractedBuyTokenAddress,
                        extractedSellTokenCreatorId,
                        extractedBuyTokenCreatorId,
                        subjectTokenDetails,
                        moxieUserId,
                        runtime,
                        callback
                    );

                    // similarly check isGraduated for the sell and buy tokens
                    const isSellTokenGraduated =
                        sellTokenSubjectTokenDetails?.isGraduated;
                    const isBuyTokenGraduated =
                        buyTokenSubjectTokenDetails?.isGraduated;

                    // Assign token addresses and symbols for non-creator coins
                    if (!isSellTokenCreatorCoin || isSellTokenGraduated) {
                        sellTokenAddress =
                            sellTokenSubjectTokenDetails?.id ||
                            subjectTokenDetails?.[extractedSellTokenAddress]
                                ?.id ||
                            extractedSellTokenAddress;
                        sellTokenSymbol =
                            sellTokenSubjectTokenDetails?.symbol ||
                            subjectTokenDetails?.[extractedSellTokenAddress]
                                ?.symbol ||
                            extractedSellTokenSymbol;
                    }

                    if (!isBuyTokenCreatorCoin || isBuyTokenGraduated) {
                        buyTokenAddress =
                            buyTokenSubjectTokenDetails?.id ||
                            subjectTokenDetails?.[extractedBuyTokenAddress]
                                ?.id ||
                            extractedBuyTokenAddress;
                        buyTokenSymbol =
                            buyTokenSubjectTokenDetails?.symbol ||
                            subjectTokenDetails?.[extractedBuyTokenAddress]
                                ?.symbol ||
                            extractedBuyTokenSymbol;
                    }

                    // Validate creator presence
                    const hasSellCreator =
                        (!!extractedSellTokenCreatorId ||
                            isSellTokenCreatorCoin) &&
                        !isSellTokenGraduated;
                    const hasBuyCreator =
                        (!!extractedBuyTokenCreatorId ||
                            isBuyTokenCreatorCoin) &&
                        !isBuyTokenGraduated;
                    const swapType =
                        hasSellCreator && hasBuyCreator
                            ? "CREATOR_TO_CREATOR"
                            : hasSellCreator
                              ? "CREATOR_TO_TOKEN"
                              : hasBuyCreator
                                ? "TOKEN_TO_CREATOR"
                                : "TOKEN_TO_TOKEN";
                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [SWAP_TYPE] swapType: ${swapType}`
                    );

                    if (swapType == "CREATOR_TO_CREATOR") {
                        elizaLogger.debug(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] starting creator to creator swap`
                        );

                        // get the subject token address
                        const sellTokenSubjectTokenAddress =
                            sellTokenSubjectTokenDetails?.id;
                        const buyTokenSubjectTokenAddress =
                            buyTokenSubjectTokenDetails?.id;

                        elizaLogger.debug(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] sellTokenSubjectTokenAddress: ${sellTokenSubjectTokenAddress} and buyTokenSubjectTokenAddress: ${buyTokenSubjectTokenAddress}`
                        );

                        // fetch decimals for the sell Tokens.
                        const buyTokenDecimals = buyTokenSubjectTokenDetails
                            ? Number(buyTokenSubjectTokenDetails.decimals)
                            : 18;
                        const sellTokenDecimals = sellTokenSubjectTokenDetails
                            ? Number(sellTokenSubjectTokenDetails.decimals)
                            : 18;

                        elizaLogger.debug(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] buyTokenDecimals: ${buyTokenDecimals} and sellTokenDecimals: ${sellTokenDecimals}`
                        );

                        // get the subject address
                        const sellTokenSubjectAddress =
                            sellTokenSubjectTokenDetails?.subject?.id;
                        const buyTokenSubjectAddress =
                            buyTokenSubjectTokenDetails?.subject?.id;
                        elizaLogger.debug(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] sellTokenSubjectAddress: ${sellTokenSubjectAddress} and buyTokenSubjectAddress: ${buyTokenSubjectAddress}`
                        );

                        let moxieInWEI: bigint;
                        let quantityInWEI: bigint;

                        if (buyQuantity) {
                            let updatedBuyQuantity = buyQuantity;
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] [BUY_QUANTITY] updatedBuyQuantity: ${updatedBuyQuantity}`
                            );
                            // Calculate moxie required for buy quantity
                            const buyTokenCurrentPriceInWEI = Decimal(
                                buyTokenSubjectTokenDetails.currentPriceInWeiInMoxie
                            );
                            if (value_type && value_type == "USD") {
                                // usd based operations
                                const usdQuantityInWEI = ethers.parseUnits(
                                    buyQuantity.toString(),
                                    USDC_TOKEN_DECIMALS
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BUY_QUANTITY] [VALUE_TYPE]: ${usdQuantityInWEI}`
                                );
                                try {
                                    // const price = await get0xPrice({
                                    //     moxieUserId,
                                    //     sellAmountBaseUnits: usdQuantityInWEI.toString(),
                                    //     buyTokenAddress: MOXIE_TOKEN_ADDRESS,
                                    //     walletAddress: agentWallet.address,
                                    //     sellTokenAddress: USDC_ADDRESS,
                                    // });

                                    // use codex to get the price
                                    const price = await getPrice(
                                        traceId,
                                        moxieUserId,
                                        usdQuantityInWEI.toString(),
                                        USDC_ADDRESS,
                                        USDC_TOKEN_DECIMALS,
                                        USDC,
                                        MOXIE_TOKEN_ADDRESS,
                                        MOXIE_TOKEN_DECIMALS,
                                        MOXIE
                                    );

                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] [BUY_QUANTITY] price: ${price}`
                                    );
                                    const buyAmountInWEI = BigInt(price);
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] [BUY_QUANTITY] buyAmountInWEI: ${buyAmountInWEI}`
                                    );

                                    // check how many tokens can be bought with the moxie
                                    const requiredBuyQuantityInWEI =
                                        await calculateTokensBuy(
                                            traceId,
                                            moxieUserId,
                                            buyTokenSubjectAddress,
                                            buyAmountInWEI
                                        );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] [BUY_QUANTITY] requiredBuyQuantityInWEI: ${requiredBuyQuantityInWEI}`
                                    );

                                    // convert wei into format units
                                    const requiredBuyQuantity =
                                        ethers.formatUnits(
                                            requiredBuyQuantityInWEI,
                                            buyTokenDecimals
                                        );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] [BUY_QUANTITY] requiredBuyQuantity: ${requiredBuyQuantity}`
                                    );

                                    updatedBuyQuantity =
                                        Number(requiredBuyQuantity);
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] [BUY_QUANTITY] [ERROR] Error: ${error}`
                                    );
                                    return true;
                                }
                            }
                            const moxieRequiredInWEI = Decimal(
                                updatedBuyQuantity.toString()
                            )
                                .mul(buyTokenCurrentPriceInWEI)
                                .toFixed(buyTokenDecimals) // Force exactly 18 decimal places
                                .replace(/\.?0+$/, ""); // Remove trailing zeros and decimal point if whole number
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] [BUY_QUANTITY] moxieRequiredInWEI: ${moxieRequiredInWEI}`
                            );

                            // now check the selling token
                            const sellTokenCurrentPriceInWEI = Decimal(
                                sellTokenSubjectTokenDetails.currentPriceInWeiInMoxie
                            );
                            const requiredSellQuantity = Decimal(
                                moxieRequiredInWEI
                            )
                                .div(sellTokenCurrentPriceInWEI)
                                .toFixed(sellTokenDecimals) // Force exactly 18 decimal places
                                .replace(/\.?0+$/, ""); // Remove trailing zeros and decimal point if whole number
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] [REQUIRED_SELL_QUANTITY] requiredSellQuantity: ${requiredSellQuantity}`
                            );

                            const requiredSellQuantityInWEI = ethers.parseUnits(
                                requiredSellQuantity,
                                sellTokenDecimals
                            );
                            // check if we have enough quantity to sell
                            const currentSellTokenBalanceInWEI =
                                await getERC20Balance(
                                    traceId,
                                    sellTokenSubjectTokenAddress,
                                    agentWallet.address
                                );
                            if (
                                BigInt(currentSellTokenBalanceInWEI) <
                                requiredSellQuantityInWEI
                            ) {
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] [BUY_QUANTITY] insufficient balance: ${currentSellTokenBalanceInWEI} < ${requiredSellQuantityInWEI}`
                                );
                                await callback({
                                    text: `\nYou do not have enough ${sellTokenSubjectTokenDetails.name} creator coins to complete the operation.
                                    \nCurrent balance: ${ethers.formatUnits(currentSellTokenBalanceInWEI, sellTokenDecimals)} ${sellTokenSubjectTokenDetails.name}
                                    \nRequired balance: ${ethers.formatUnits(requiredSellQuantityInWEI, sellTokenDecimals)} ${sellTokenSubjectTokenDetails.name}
                                    \n\nWould you like me to use your maximum available balance of ${ethers.formatEther(currentSellTokenBalanceInWEI)} tokens for this transaction?`,
                                });
                                return true;
                            }

                            // proceed to sell the required sell quantity
                            const sellResponse = await executeSellAction(
                                traceId,
                                moxieUserId,
                                provider,
                                agentWallet.address,
                                sellTokenSubjectAddress,
                                sellTokenSubjectTokenAddress,
                                requiredSellQuantityInWEI,
                                callback,
                                walletClient
                            );
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] [BUY_QUANTITY] sellAction response: ${JSON.stringify(sellResponse)}`
                            );

                            // process sell response
                            if (sellResponse.success == false) {
                                elizaLogger.error(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] [BUY_QUANTITY] sellAction failed: ${JSON.stringify(sellResponse)}`
                                );
                                await callback?.({
                                    text: `\nAn error occurred while performing the swap operation. Please try again.`,
                                    content: {
                                        error: "SWAP_OPERATION_FAILED",
                                    },
                                });
                                return true;
                            }

                            // get the moxie received in the sell action
                            const moxieReceivedInWEI =
                                "moxieReceived" in sellResponse
                                    ? ethers.parseUnits(
                                          sellResponse.moxieReceived,
                                          MOXIE_TOKEN_DECIMALS
                                      )
                                    : 0n;

                            // now buy the buytoken with the received moxie
                            const buyResponse = await executeBuyAction(
                                traceId,
                                moxieUserId,
                                provider,
                                agentWallet.address,
                                buyTokenSubjectAddress,
                                moxieReceivedInWEI,
                                callback,
                                walletClient,
                                buyTokenSubjectTokenDetails.name
                            );
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] [BUY_QUANTITY] buyAction response: ${JSON.stringify(buyResponse)}`
                            );

                            if (buyResponse.success == false) {
                                elizaLogger.error(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [${swapType}] [BUY_QUANTITY] buyAction failed: ${JSON.stringify(buyResponse)}`
                                );
                                await callback?.({
                                    text: `\nAn error occurred while performing the swap operation. Please try again.`,
                                    content: {
                                        error: "SWAP_OPERATION_FAILED",
                                    },
                                });
                                return true;
                            }
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BUY_QUANTITY] buyAction response: ${JSON.stringify(buyResponse)}`
                            );
                        } else if (sellQuantity) {
                            let sellQuantityInWEI = ethers.parseUnits(
                                sellQuantity.toString(),
                                sellTokenDecimals
                            );
                            if (value_type && value_type == "USD") {
                                // if value type is USD then convert to USDC
                                sellQuantityInWEI = ethers.parseUnits(
                                    sellQuantity.toString(),
                                    USDC_TOKEN_DECIMALS
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [VALUE_TYPE]: ${value_type}`
                                );
                                try {
                                    // const price = await get0xPrice({
                                    //     moxieUserId,
                                    //     sellAmountBaseUnits: sellQuantityInWEI.toString(),
                                    //     buyTokenAddress: MOXIE_TOKEN_ADDRESS,
                                    //     walletAddress: agentWallet.address,
                                    //     sellTokenAddress: USDC_ADDRESS,
                                    // });

                                    // use codex to get the price
                                    const price = await getPrice(
                                        traceId,
                                        moxieUserId,
                                        sellQuantityInWEI.toString(),
                                        USDC_ADDRESS,
                                        USDC_TOKEN_DECIMALS,
                                        USDC,
                                        MOXIE_TOKEN_ADDRESS,
                                        MOXIE_TOKEN_DECIMALS,
                                        MOXIE
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] price: ${price}`
                                    );
                                    moxieInWEI = BigInt(price);
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] moxieInWEI: ${moxieInWEI}`
                                    );

                                    // use the moxie to get the sell quantity in WEI
                                    const currentPriceInWEIMoxie = Decimal(
                                        sellTokenSubjectTokenDetails.currentPriceInWeiInMoxie
                                    );

                                    const result = Decimal(price)
                                        .div(currentPriceInWEIMoxie)
                                        .toFixed(18) // Force exactly 18 decimal places
                                        .replace(/\.?0+$/, ""); // Remove trailing zeros and decimal point if whole number

                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] result: ${result}`
                                    );

                                    quantityInWEI = ethers.parseEther(result);
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] quantityInWEI: ${quantityInWEI}`
                                    );

                                    // execute sell action
                                    const swapResp = await executeSellAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        sellTokenSubjectAddress,
                                        sellTokenSubjectTokenAddress,
                                        quantityInWEI,
                                        callback,
                                        walletClient
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] swap response: ${JSON.stringify(swapResp)}`
                                    );

                                    if (swapResp.success == false) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                        );
                                        return true;
                                    }

                                    moxieInWEI =
                                        "moxieReceived" in swapResp
                                            ? ethers.parseUnits(
                                                  swapResp.moxieReceived,
                                                  MOXIE_TOKEN_DECIMALS
                                              )
                                            : 0n;

                                    // execute buy action
                                    const buyResp = await executeBuyAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        buyTokenSubjectAddress,
                                        moxieInWEI,
                                        callback,
                                        walletClient,
                                        buyTokenSubjectTokenDetails.name
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] buyResp: ${JSON.stringify(buyResp)}`
                                    );
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [USD_VALUE_TYPE] [ERROR] Error: ${error}`
                                    );
                                    return true;
                                }
                            } else {
                                // this is for non USD value type
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] sellQuantityInWEI: ${sellQuantityInWEI}`
                                );

                                quantityInWEI = sellQuantityInWEI;
                                // execute sell action
                                const swapResp = await executeSellAction(
                                    traceId,
                                    moxieUserId,
                                    provider,
                                    agentWallet.address,
                                    sellTokenSubjectAddress,
                                    sellTokenSubjectTokenAddress,
                                    quantityInWEI,
                                    callback,
                                    walletClient
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] [MOXIE] executeSellAction  response: ${JSON.stringify(swapResp)}`
                                );

                                if (swapResp.success == false) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] [MOXIE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                    );
                                    return true;
                                }
                                moxieInWEI =
                                    "moxieReceived" in swapResp
                                        ? ethers.parseUnits(
                                              swapResp.moxieReceived,
                                              MOXIE_TOKEN_DECIMALS
                                          )
                                        : 0n;

                                // execute buy action
                                const buyResp = await executeBuyAction(
                                    traceId,
                                    moxieUserId,
                                    provider,
                                    agentWallet.address,
                                    buyTokenSubjectAddress,
                                    moxieInWEI,
                                    callback,
                                    walletClient,
                                    buyTokenSubjectTokenDetails.name
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [DEFAULT] [MOXIE] buyResp: ${JSON.stringify(buyResp)}`
                                );
                            }
                        } else if (balance && balance.type) {
                            // balance based swap
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BALANCE_BASED] balance type: ${JSON.stringify(balance)}`
                            );
                            try {
                                const result =
                                    await getTargetQuantityForBalanceBasedSwaps(
                                        traceId,
                                        currentWalletBalanceForBalanceBasedSwaps[
                                            sellTokenSubjectTokenAddress
                                        ],
                                        moxieUserId,
                                        sellTokenSubjectTokenAddress,
                                        sellTokenSubjectTokenDetails.name,
                                        agentWallet,
                                        balance,
                                        callback
                                    );
                                quantityInWEI = result.quantityInWEI;
                                currentWalletBalanceForBalanceBasedSwaps[
                                    sellTokenSubjectTokenAddress
                                ] = result.currentWalletBalance;
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BALANCE_BASED] quantityInWEI: ${quantityInWEI}`
                                );
                                // execute sell action
                                const swapResp = await executeSellAction(
                                    traceId,
                                    moxieUserId,
                                    provider,
                                    agentWallet.address,
                                    sellTokenSubjectAddress,
                                    sellTokenSubjectTokenAddress,
                                    quantityInWEI,
                                    callback,
                                    walletClient
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BALANCE_BASED] [MOXIE] executeSellAction  response: ${JSON.stringify(swapResp)}`
                                );

                                if (swapResp.success == false) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BALANCE_BASED] [MOXIE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                    );
                                    return true;
                                }
                                moxieInWEI =
                                    "moxieReceived" in swapResp
                                        ? ethers.parseUnits(
                                              swapResp.moxieReceived,
                                              MOXIE_TOKEN_DECIMALS
                                          )
                                        : 0n;

                                // execute buy action
                                const buyResp = await executeBuyAction(
                                    traceId,
                                    moxieUserId,
                                    provider,
                                    agentWallet.address,
                                    buyTokenSubjectAddress,
                                    moxieInWEI,
                                    callback,
                                    walletClient,
                                    buyTokenSubjectTokenDetails.name
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BALANCE_BASED] [MOXIE] buyResp: ${JSON.stringify(buyResp)}`
                                );

                                if (buyResp.success == false) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BALANCE_BASED] [MOXIE] buyAction failed: ${JSON.stringify(buyResp)}`
                                    );
                                    return true;
                                }
                            } catch (error) {
                                elizaLogger.error(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_CREATOR] [BALANCE_BASED] Error getting balance based quantity: ${error}`
                                );
                                return true;
                            }
                        }
                    } else if (swapType == "CREATOR_TO_TOKEN") {
                        elizaLogger.debug(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] swap type: ${swapType}`
                        );

                        // get the subject token address
                        const sellTokenSubjectTokenAddress =
                            sellTokenSubjectTokenDetails?.id;

                        // fetch decimals for the sell Tokens. If ETH the use 18
                        const buyTokenDecimals =
                            buyTokenSymbol === "ETH"
                                ? 18
                                : await getERC20Decimals(
                                      traceId,
                                      buyTokenAddress
                                  );
                        const sellTokenDecimals = sellTokenSubjectTokenDetails
                            ? Number(sellTokenSubjectTokenDetails.decimals)
                            : 18;

                        // get the subject address
                        const sellTokenSubjectAddress =
                            sellTokenSubjectTokenDetails?.subject?.id;

                        let sellQuantityInWEI: bigint;
                        let moxieInWEI: bigint;
                        let quantityInWEI: bigint;
                        if (buyQuantity) {
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BUY_QUANTITY] quantityInWEI: ${quantityInWEI}`
                            );
                            if (value_type && value_type == "USD") {
                                let requiredBuyAmountInWEI: bigint;
                                const usdcQuantityInWEI = ethers.parseUnits(
                                    buyQuantity.toString(),
                                    USDC_TOKEN_DECIMALS
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE]: ${value_type}`
                                );
                                try {
                                    // const price = await get0xPrice({
                                    //     moxieUserId,
                                    //     sellAmountBaseUnits: usdcQuantityInWEI.toString(),
                                    //     buyTokenAddress: MOXIE_TOKEN_ADDRESS,
                                    //     walletAddress: agentWallet.address,
                                    //     sellTokenAddress: USDC_ADDRESS,
                                    // });

                                    // use codex to get the price
                                    const price = await getPrice(
                                        traceId,
                                        moxieUserId,
                                        usdcQuantityInWEI.toString(),
                                        USDC_ADDRESS,
                                        USDC_TOKEN_DECIMALS,
                                        USDC,
                                        MOXIE_TOKEN_ADDRESS,
                                        MOXIE_TOKEN_DECIMALS,
                                        MOXIE
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] price: ${price}`
                                    );
                                    quantityInWEI = BigInt(price);
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] quantityInWEI from getUSDEquivalentPrice: ${quantityInWEI}`
                                    );
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE]: ${value_type} Error getting price: ${error}`
                                    );
                                    return true;
                                }
                            } else {
                                if (buyTokenSymbol === "MOXIE") {
                                    quantityInWEI = ethers.parseUnits(
                                        buyQuantity.toString(),
                                        MOXIE_TOKEN_DECIMALS
                                    );
                                } else {
                                    // if the buy token is not MOXIE then we need to get moxie required
                                    const erc20QuantityInWEI =
                                        ethers.parseUnits(
                                            buyQuantity.toString(),
                                            buyTokenDecimals
                                        );
                                    try {
                                        // const price = await get0xPrice({
                                        //     moxieUserId,
                                        //     sellAmountBaseUnits: erc20QuantityInWEI.toString(),
                                        //     buyTokenAddress: MOXIE_TOKEN_ADDRESS,
                                        //     walletAddress: agentWallet.address,
                                        //     sellTokenAddress: buyTokenAddress,
                                        // });

                                        // use codex to get the price
                                        const price = await getPrice(
                                            traceId,
                                            moxieUserId,
                                            erc20QuantityInWEI.toString(),
                                            buyTokenAddress,
                                            buyTokenDecimals,
                                            buyTokenSymbol,
                                            MOXIE_TOKEN_ADDRESS,
                                            MOXIE_TOKEN_DECIMALS,
                                            MOXIE
                                        );
                                        quantityInWEI = BigInt(price);
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] quantityInWEI from getPrice: ${quantityInWEI}`
                                        );
                                    } catch (error) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] Error getting price: ${error}`
                                        );
                                        return true;
                                    }
                                }
                            }
                            // now check the creator coins to sell equivalent to the required buy amount
                            const currentPriceInWEIMoxie = Decimal(
                                sellTokenSubjectTokenDetails.currentPriceInWeiInMoxie
                            );
                            const requiredSellQuantity = Decimal(
                                quantityInWEI.toString()
                            )
                                .div(currentPriceInWEIMoxie)
                                .toFixed(sellTokenDecimals)
                                .replace(/\.?0+$/, ""); // Remove trailing zeros and decimal point if whole number

                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] requiredSellQuantity: ${requiredSellQuantity}`
                            );
                            const requiredSellQuantityInWEI = ethers.parseUnits(
                                requiredSellQuantity,
                                sellTokenDecimals
                            );
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] requiredSellQuantityInWEI: ${requiredSellQuantityInWEI}`
                            );

                            // now check the balance of the creator coins to sell
                            const availableTokenBalanceInWEI =
                                await getERC20Balance(
                                    traceId,
                                    sellTokenSubjectTokenAddress,
                                    agentWallet.address
                                );
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] availableTokenBalanceInWEI: ${availableTokenBalanceInWEI}`
                            );

                            if (
                                BigInt(availableTokenBalanceInWEI) <
                                BigInt(requiredSellQuantityInWEI)
                            ) {
                                elizaLogger.error(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] insufficient balance: ${availableTokenBalanceInWEI} < ${requiredSellQuantityInWEI}`
                                );
                                await callback({
                                    text: `\nInsufficient balance to complete this transaction.
                                         \nAvailable Balance: ${ethers.formatUnits(availableTokenBalanceInWEI, sellTokenDecimals)} ${sellTokenSubjectTokenDetails.name}
                                         \nRequested Amount: ${ethers.formatUnits(requiredSellQuantity, sellTokenDecimals)} ${sellTokenSubjectTokenDetails.name}
                                         \n\nWould you like me to use your available balance of ${ethers.formatUnits(availableTokenBalanceInWEI, sellTokenDecimals)} ${sellTokenSubjectTokenDetails.name} for this transaction?`,
                                });
                                return true;
                            }
                            quantityInWEI = requiredSellQuantityInWEI;

                            // now we can execute the sell action
                            const swapResp = await executeSellAction(
                                traceId,
                                moxieUserId,
                                provider,
                                agentWallet.address,
                                sellTokenSubjectAddress,
                                sellTokenSubjectTokenAddress,
                                quantityInWEI,
                                callback,
                                walletClient
                            );
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] swap response: ${JSON.stringify(swapResp)}`
                            );

                            if (swapResp.success == false) {
                                elizaLogger.error(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                );
                                return true;
                            }

                            moxieInWEI =
                                "moxieReceived" in swapResp
                                    ? ethers.parseUnits(
                                          swapResp.moxieReceived,
                                          MOXIE_TOKEN_DECIMALS
                                      )
                                    : 0n;

                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] moxieInWEI from executeSellAction: ${moxieInWEI}`
                            );

                            if (buyTokenSymbol !== "MOXIE") {
                                // swap to the requested buy token
                                try {
                                    const buyAmountInWEI = await swap(
                                        traceId,
                                        buyTokenAddress,
                                        buyTokenSymbol,
                                        MOXIE_TOKEN_ADDRESS,
                                        MOXIE,
                                        moxieUserId,
                                        agentWallet.address,
                                        moxieInWEI,
                                        provider,
                                        MOXIE_TOKEN_DECIMALS,
                                        buyTokenDecimals,
                                        callback,
                                        state.agentWalletBalance,
                                        walletClient
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] buyAmountInWEI: ${buyAmountInWEI}`
                                    );
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE] Error swapping to MOXIE: ${error}`
                                    );
                                    return true;
                                }
                            }
                        } else if (sellQuantity) {
                            sellQuantityInWEI = ethers.parseUnits(
                                sellQuantity.toString(),
                                MOXIE_TOKEN_DECIMALS
                            );
                            if (value_type && value_type == "USD") {
                                // if value type is USD then convert to USDC
                                sellQuantityInWEI = ethers.parseUnits(
                                    sellQuantity.toString(),
                                    USDC_TOKEN_DECIMALS
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [VALUE_TYPE]: ${value_type}`
                                );
                                try {
                                    // const price = await get0xPrice({
                                    //     moxieUserId,
                                    //     sellAmountBaseUnits: sellQuantityInWEI.toString(),
                                    //     buyTokenAddress: MOXIE_TOKEN_ADDRESS,
                                    //     walletAddress: agentWallet.address,
                                    //     sellTokenAddress: USDC_ADDRESS,
                                    // });

                                    // use codex to get the price
                                    const price = await getPrice(
                                        traceId,
                                        moxieUserId,
                                        sellQuantityInWEI.toString(),
                                        USDC_ADDRESS,
                                        USDC_TOKEN_DECIMALS,
                                        USDC,
                                        MOXIE_TOKEN_ADDRESS,
                                        MOXIE_TOKEN_DECIMALS,
                                        MOXIE
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] price: ${price}`
                                    );
                                    moxieInWEI = BigInt(price);
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] moxieInWEI from getPrice: ${moxieInWEI}`
                                    );

                                    // use the moxie to get the sell quantity in WEI
                                    const currentPriceInWEIMoxie = Decimal(
                                        sellTokenSubjectTokenDetails.currentPriceInWeiInMoxie
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] currentPriceInWEIMoxie: ${currentPriceInWEIMoxie}`
                                    );

                                    const result = Decimal(price)
                                        .div(currentPriceInWEIMoxie)
                                        .toFixed(18) // Force exactly 18 decimal places
                                        .replace(/\.?0+$/, ""); // Remove trailing zeros and decimal point if whole number

                                    await callback({
                                        text: `\nYou will receive approximately ${result} ${sellTokenSubjectTokenDetails.name} creator coins`,
                                    });

                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] result: ${result}`
                                    );

                                    quantityInWEI = ethers.parseEther(result);
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] quantityInWEI: ${quantityInWEI}`
                                    );

                                    // execute sell action
                                    const swapResp = await executeSellAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        sellTokenSubjectAddress,
                                        sellTokenSubjectTokenAddress,
                                        quantityInWEI,
                                        callback,
                                        walletClient
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] swap response: ${JSON.stringify(swapResp)}`
                                    );

                                    if (swapResp.success == false) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                        );
                                        return true;
                                    }
                                    moxieInWEI =
                                        "moxieReceived" in swapResp
                                            ? ethers.parseUnits(
                                                  swapResp.moxieReceived,
                                                  MOXIE_TOKEN_DECIMALS
                                              )
                                            : 0n;
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] moxieInWEI from executeSellAction: ${moxieInWEI}`
                                    );
                                    if (buyTokenSymbol !== "MOXIE") {
                                        // swap to the requested buy token
                                        try {
                                            const buyAmountInWEI = await swap(
                                                traceId,
                                                buyTokenAddress,
                                                buyTokenSymbol,
                                                MOXIE_TOKEN_ADDRESS,
                                                MOXIE,
                                                moxieUserId,
                                                agentWallet.address,
                                                moxieInWEI,
                                                provider,
                                                MOXIE_TOKEN_DECIMALS,
                                                buyTokenDecimals,
                                                callback,
                                                state.agentWalletBalance,
                                                walletClient
                                            );
                                            elizaLogger.debug(
                                                traceId,
                                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] buyAmountInWEI: ${buyAmountInWEI}`
                                            );
                                        } catch (error) {
                                            elizaLogger.error(
                                                traceId,
                                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] Error swapping to MOXIE: ${error}`
                                            );
                                            return true;
                                        }
                                    }
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] Error getting USD value quantity: ${error}`
                                    );
                                    return true;
                                }
                            } else {
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] sellQuantityInWEI: ${sellQuantityInWEI}`
                                );

                                if (buyTokenSymbol === "MOXIE") {
                                    quantityInWEI = sellQuantityInWEI;
                                    // execute sell action
                                    const swapResp = await executeSellAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        sellTokenSubjectAddress,
                                        sellTokenSubjectTokenAddress,
                                        quantityInWEI,
                                        callback,
                                        walletClient
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] [MOXIE] executeSellAction  response: ${JSON.stringify(swapResp)}`
                                    );

                                    if (swapResp.success == false) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] [MOXIE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                        );
                                        return true;
                                    }
                                } else {
                                    quantityInWEI = sellQuantityInWEI;
                                    // execute sell action
                                    const swapResp = await executeSellAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        sellTokenSubjectAddress,
                                        sellTokenSubjectTokenAddress,
                                        quantityInWEI,
                                        callback,
                                        walletClient
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] executeSellAction response: ${JSON.stringify(swapResp)}`
                                    );

                                    if (swapResp.success == false) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                        );
                                        return true;
                                    }

                                    moxieInWEI =
                                        "moxieReceived" in swapResp
                                            ? ethers.parseUnits(
                                                  swapResp.moxieReceived,
                                                  MOXIE_TOKEN_DECIMALS
                                              )
                                            : 0n;

                                    // swap to the requested buy token
                                    try {
                                        const buyAmountInWEI = await swap(
                                            traceId,
                                            buyTokenAddress,
                                            buyTokenSymbol,
                                            MOXIE_TOKEN_ADDRESS,
                                            MOXIE,
                                            moxieUserId,
                                            agentWallet.address,
                                            moxieInWEI,
                                            provider,
                                            MOXIE_TOKEN_DECIMALS,
                                            buyTokenDecimals,
                                            callback,
                                            state.agentWalletBalance,
                                            walletClient
                                        );
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] swap response - buyAmountInWEI: ${buyAmountInWEI}`
                                        );
                                    } catch (error) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] Error swapping to MOXIE: ${error}`
                                        );
                                        return true;
                                    }
                                }
                            }
                        } else if (balance && balance.type) {
                            // balance based swap
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] balance type: ${JSON.stringify(balance)}`
                            );
                            try {
                                const result =
                                    await getTargetQuantityForBalanceBasedSwaps(
                                        traceId,
                                        currentWalletBalanceForBalanceBasedSwaps[
                                            sellTokenSubjectTokenAddress
                                        ],
                                        moxieUserId,
                                        sellTokenSubjectTokenAddress,
                                        sellTokenSubjectTokenDetails.name,
                                        agentWallet,
                                        balance,
                                        callback
                                    );
                                quantityInWEI = result.quantityInWEI;
                                currentWalletBalanceForBalanceBasedSwaps[
                                    sellTokenSubjectTokenAddress
                                ] = result.currentWalletBalance;
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] quantityInWEI: ${quantityInWEI}`
                                );

                                // execute sell action
                                const swapResp = await executeSellAction(
                                    traceId,
                                    moxieUserId,
                                    provider,
                                    agentWallet.address,
                                    sellTokenSubjectAddress,
                                    sellTokenSubjectTokenAddress,
                                    quantityInWEI,
                                    callback,
                                    walletClient
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] [MOXIE] executeSellAction  response: ${JSON.stringify(swapResp)}`
                                );

                                if (swapResp.success == false) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] [MOXIE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                    );
                                    return true;
                                }
                                moxieInWEI =
                                    "moxieReceived" in swapResp
                                        ? ethers.parseUnits(
                                              swapResp.moxieReceived,
                                              MOXIE_TOKEN_DECIMALS
                                          )
                                        : 0n;
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] [MOXIE] moxieInWEI: ${moxieInWEI}`
                                );

                                if (buyTokenSymbol !== "MOXIE") {
                                    // execute swap to the requested buy token
                                    try {
                                        const buyAmountInWEI = await swap(
                                            traceId,
                                            buyTokenAddress,
                                            buyTokenSymbol,
                                            MOXIE_TOKEN_ADDRESS,
                                            MOXIE,
                                            moxieUserId,
                                            agentWallet.address,
                                            moxieInWEI,
                                            provider,
                                            MOXIE_TOKEN_DECIMALS,
                                            buyTokenDecimals,
                                            callback,
                                            state.agentWalletBalance,
                                            walletClient
                                        );
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] [MOXIE] buyAmountInWEI: ${buyAmountInWEI}`
                                        );
                                    } catch (error) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] [MOXIE] Error swapping to MOXIE: ${error}`
                                        );
                                        return true;
                                    }
                                }
                            } catch (error) {
                                elizaLogger.error(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] Error getting balance based quantity: ${error}`
                                );
                                return true;
                            }
                        }
                    } else if (swapType == "TOKEN_TO_CREATOR") {
                        elizaLogger.debug(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] swap type: ${swapType}`
                        );

                        const buyTokenSubjectAddress =
                            buyTokenSubjectTokenDetails?.subject?.id;

                        // fetch decimals for the sell Tokens. If ETH the use 18
                        const sellTokenDecimals =
                            sellTokenSymbol === "ETH"
                                ? 18
                                : await getERC20Decimals(
                                      traceId,
                                      sellTokenAddress
                                  );

                        let sellQuantityInWEI: bigint;
                        let moxieInWEI: bigint;
                        let quantityInWEI: bigint;

                        // if user is asking to purchase interms of buy quantity then we need to calculate the moxie in WEI
                        if (buyQuantity) {
                            let buyQuantityInWEI = ethers.parseUnits(
                                buyQuantity.toString(),
                                sellTokenDecimals
                            );
                            if (value_type && value_type == "USD") {
                                // this case is for the case where the user is asking to purchase in terms of buy quantity in USD
                                buyQuantityInWEI = ethers.parseUnits(
                                    buyQuantity.toString(),
                                    USDC_TOKEN_DECIMALS
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] [VALUE_TYPE]: ${value_type}`
                                );
                                try {
                                    if (sellTokenSymbol != "USDC") {
                                        // dont need to get price if selling USDC
                                        // const price = await get0xPrice({
                                        //     moxieUserId,
                                        //     sellAmountBaseUnits: buyQuantityInWEI.toString(),
                                        //     buyTokenAddress: sellTokenAddress,
                                        //     walletAddress: agentWallet.address,
                                        //     sellTokenAddress: USDC_ADDRESS,
                                        // });

                                        // use codex to get the price
                                        const price = await getPrice(
                                            traceId,
                                            moxieUserId,
                                            buyQuantityInWEI.toString(),
                                            USDC_ADDRESS,
                                            USDC_TOKEN_DECIMALS,
                                            USDC,
                                            sellTokenAddress,
                                            sellTokenDecimals,
                                            sellTokenSymbol
                                        );
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] [USD_VALUE_TYPE] price from getPrice: ${price}`
                                        );
                                        buyQuantityInWEI = BigInt(price);

                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] [USD_VALUE_TYPE] buyQuantityInWEI: ${buyQuantityInWEI}`
                                        );

                                        await callback({
                                            text: `\nIndicative Conversation Rate: ${buyQuantity} ${USDC} = ${ethers.formatUnits(buyQuantityInWEI, sellTokenDecimals)} ${sellTokenSymbol} `,
                                        });
                                    }

                                    // swap to moxie if not MOXIE
                                    if (sellTokenSymbol != "MOXIE") {
                                        try {
                                            // swap to the requested buy token
                                            const buyAmountInWEI = await swap(
                                                traceId,
                                                MOXIE_TOKEN_ADDRESS,
                                                MOXIE,
                                                sellTokenAddress,
                                                sellTokenSymbol,
                                                moxieUserId,
                                                agentWallet.address,
                                                buyQuantityInWEI,
                                                provider,
                                                sellTokenDecimals,
                                                MOXIE_TOKEN_DECIMALS,
                                                callback,
                                                state.agentWalletBalance,
                                                walletClient
                                            );
                                            elizaLogger.debug(
                                                traceId,
                                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] [USD_VALUE_TYPE] buyAmountInWEI: ${buyAmountInWEI}`
                                            );
                                            buyQuantityInWEI = buyAmountInWEI;
                                        } catch (error) {
                                            elizaLogger.error(
                                                traceId,
                                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] [USD_VALUE_TYPE] Error swapping to MOXIE: ${error}`
                                            );
                                            return true;
                                        }
                                    }

                                    // check if user has enough moxie to complete this purchage
                                    const moxieBalance = await getERC20Balance(
                                        traceId,
                                        MOXIE_TOKEN_ADDRESS,
                                        agentWallet.address
                                    );
                                    const currentBalance =
                                        moxieBalance !== ""
                                            ? BigInt(moxieBalance)
                                            : 0n;
                                    if (currentBalance < buyQuantityInWEI) {
                                        await handleInsufficientBalance(
                                            traceId,
                                            state.agentWalletBalance,
                                            moxieUserId,
                                            MOXIE_TOKEN_ADDRESS,
                                            MOXIE,
                                            buyQuantityInWEI,
                                            currentBalance,
                                            MOXIE_TOKEN_DECIMALS,
                                            agentWallet.address,
                                            callback,
                                            buyTokenAddress
                                        );
                                        return true;
                                    }
                                    // execute buy action
                                    const swapResp = await executeBuyAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        buyTokenSubjectAddress,
                                        buyQuantityInWEI,
                                        callback,
                                        walletClient,
                                        buyTokenSubjectTokenDetails.name
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] [USD_VALUE_TYPE] swap response: ${JSON.stringify(swapResp)}`
                                    );

                                    if (swapResp.success == false) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] [USD_VALUE_TYPE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                        );
                                        return true;
                                    }
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] [USD_VALUE_TYPE] Error getting price: ${error}`
                                    );
                                    return true;
                                }
                            } else {
                                // this is for the case where the user is asking to purchase in terms of buy quantity

                                if (sellTokenSymbol != "MOXIE") {
                                    buyQuantityInWEI = ethers.parseUnits(
                                        buyQuantity.toString(),
                                        MOXIE_TOKEN_DECIMALS
                                    );
                                }

                                moxieInWEI = await calculateTokensBuy(
                                    traceId,
                                    moxieUserId,
                                    buyTokenSubjectAddress,
                                    buyQuantityInWEI
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] moxie in WEI: ${moxieInWEI}`
                                );

                                // if the sell token is MOXIE then we can use the moxie in WEI as the quantity in WEI
                                if (sellTokenSymbol == "MOXIE") {
                                    quantityInWEI = moxieInWEI;
                                } else {
                                    // if the sell token is not MOXIE then we need to get the price of the sell token in MOXIE
                                    // get the price
                                    // const price = await get0xPrice({
                                    //     moxieUserId,
                                    //     sellAmountBaseUnits: moxieInWEI.toString(),
                                    //     buyTokenAddress: sellTokenAddress,
                                    //     walletAddress: agentWallet.address,
                                    //     sellTokenAddress: MOXIE_TOKEN_ADDRESS,
                                    // });

                                    // use codex to get the price
                                    const price = await getPrice(
                                        traceId,
                                        moxieUserId,
                                        moxieInWEI.toString(),
                                        MOXIE_TOKEN_ADDRESS,
                                        MOXIE_TOKEN_DECIMALS,
                                        MOXIE,
                                        sellTokenAddress,
                                        sellTokenDecimals,
                                        sellTokenSymbol
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] price from getPrice: ${price}`
                                    );
                                    moxieInWEI = BigInt(price);
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] moxie in WEI: ${moxieInWEI}`
                                    );

                                    // swap to the requested buy token
                                    try {
                                        const buyAmountInWEI = await swap(
                                            traceId,
                                            MOXIE_TOKEN_ADDRESS,
                                            MOXIE,
                                            sellTokenAddress,
                                            sellTokenSymbol,
                                            moxieUserId,
                                            agentWallet.address,
                                            moxieInWEI,
                                            provider,
                                            sellTokenDecimals,
                                            MOXIE_TOKEN_DECIMALS,
                                            callback,
                                            state.agentWalletBalance,
                                            walletClient
                                        );
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] buyAmountInWEI: ${buyAmountInWEI}`
                                        );
                                        quantityInWEI = buyAmountInWEI;
                                    } catch (error) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] Error swapping to MOXIE: ${error}`
                                        );
                                        return true;
                                    }
                                }

                                // check if user has enough moxie to complete this purchage
                                const moxieBalance = await getERC20Balance(
                                    traceId,
                                    MOXIE_TOKEN_ADDRESS,
                                    agentWallet.address
                                );
                                const currentBalance =
                                    moxieBalance !== ""
                                        ? BigInt(moxieBalance)
                                        : 0n;
                                if (currentBalance < quantityInWEI) {
                                    await handleInsufficientBalance(
                                        traceId,
                                        state.agentWalletBalance,
                                        moxieUserId,
                                        MOXIE_TOKEN_ADDRESS,
                                        MOXIE,
                                        quantityInWEI,
                                        currentBalance,
                                        MOXIE_TOKEN_DECIMALS,
                                        agentWallet.address,
                                        callback,
                                        buyTokenAddress
                                    );
                                    return true;
                                }
                                // callback
                                await callback?.(
                                    initiatePurchaseTemplate(
                                        buyTokenSubjectTokenDetails.name,
                                        moxieInWEI
                                    )
                                );

                                // execute buy action
                                const swapResp = await executeBuyAction(
                                    traceId,
                                    moxieUserId,
                                    provider,
                                    agentWallet.address,
                                    buyTokenSubjectAddress,
                                    quantityInWEI,
                                    callback,
                                    walletClient,
                                    buyTokenSubjectTokenDetails.name
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] swap response: ${JSON.stringify(swapResp)}`
                                );

                                if (swapResp.success == false) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [BUY_QUANTITY] executeBuyAction failed: ${JSON.stringify(swapResp)}`
                                    );
                                    return true;
                                }
                            }
                        } else if (sellQuantity) {
                            sellQuantityInWEI = ethers.parseUnits(
                                sellQuantity.toString(),
                                sellTokenDecimals
                            );
                            if (value_type && value_type == "USD") {
                                // if value type is USD then convert to USDC
                                sellQuantityInWEI = ethers.parseUnits(
                                    sellQuantity.toString(),
                                    USDC_TOKEN_DECIMALS
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [VALUE_TYPE]: ${value_type}`
                                );
                                try {
                                    if (sellTokenSymbol != "USDC") {
                                        // dont need to get price if selling USDC
                                        // const price = await get0xPrice({
                                        //     moxieUserId,
                                        //     sellAmountBaseUnits: sellQuantityInWEI.toString(),
                                        //     buyTokenAddress: sellTokenAddress,
                                        //     walletAddress: agentWallet.address,
                                        //     sellTokenAddress: USDC_ADDRESS,
                                        // });

                                        // use codex to get the price
                                        const price = await getPrice(
                                            traceId,
                                            moxieUserId,
                                            sellQuantityInWEI.toString(),
                                            USDC_ADDRESS,
                                            USDC_TOKEN_DECIMALS,
                                            USDC,
                                            sellTokenAddress,
                                            sellTokenDecimals,
                                            sellTokenSymbol
                                        );
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [USD_VALUE_TYPE] price from getUSDEquivalentPrice: ${price}`
                                        );
                                        sellQuantityInWEI = BigInt(price);

                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [USD_VALUE_TYPE] sellQuantityInWEI: ${sellQuantityInWEI}`
                                        );

                                        await callback({
                                            text: `\nIndicative Conversation Rate: ${sellQuantity} ${USDC} = ${ethers.formatUnits(sellQuantityInWEI, sellTokenDecimals)} ${sellTokenSymbol} `,
                                        });
                                    }
                                    // swap to moxie if not MOXIE
                                    if (sellTokenSymbol != "MOXIE") {
                                        try {
                                            // swap to the requested buy token
                                            const buyAmountInWEI = await swap(
                                                traceId,
                                                MOXIE_TOKEN_ADDRESS,
                                                MOXIE,
                                                sellTokenAddress,
                                                sellTokenSymbol,
                                                moxieUserId,
                                                agentWallet.address,
                                                sellQuantityInWEI,
                                                provider,
                                                sellTokenDecimals,
                                                MOXIE_TOKEN_DECIMALS,
                                                callback,
                                                state.agentWalletBalance,
                                                walletClient
                                            );
                                            elizaLogger.debug(
                                                traceId,
                                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] buyAmountInWEI: ${buyAmountInWEI}`
                                            );
                                            sellQuantityInWEI = buyAmountInWEI;
                                        } catch (error) {
                                            elizaLogger.error(
                                                traceId,
                                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [USD_VALUE_TYPE] Error swapping to MOXIE: ${error}`
                                            );
                                            return true;
                                        }
                                    }

                                    // execute buy action
                                    const swapResp = await executeBuyAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        buyTokenSubjectAddress,
                                        sellQuantityInWEI,
                                        callback,
                                        walletClient,
                                        buyTokenSubjectTokenDetails.name
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_CREATOR] [USD_VALUE_TYPE] swap response: ${JSON.stringify(swapResp)}`
                                    );

                                    if (swapResp.success == false) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                        );
                                        return true;
                                    }
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [USD_VALUE_TYPE] Error getting USD value quantity: ${error}`
                                    );
                                    return true;
                                }
                            } else {
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] sellQuantityInWEI: ${sellQuantityInWEI}`
                                );

                                if (sellTokenSymbol === "MOXIE") {
                                    quantityInWEI = sellQuantityInWEI;
                                    // execute sell action
                                    const swapResp = await executeBuyAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        buyTokenSubjectAddress,
                                        quantityInWEI,
                                        callback,
                                        walletClient,
                                        buyTokenSubjectTokenDetails.name
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] [MOXIE] executeSellAction  response: ${JSON.stringify(swapResp)}`
                                    );

                                    if (swapResp.success == false) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] [MOXIE] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                        );
                                        return true;
                                    }
                                } else {
                                    let buyAmountInWEI: bigint;
                                    try {
                                        // swap to the requested buy token
                                        buyAmountInWEI = await swap(
                                            traceId,
                                            MOXIE_TOKEN_ADDRESS,
                                            MOXIE,
                                            sellTokenAddress,
                                            sellTokenSymbol,
                                            moxieUserId,
                                            agentWallet.address,
                                            sellQuantityInWEI,
                                            provider,
                                            sellTokenDecimals,
                                            MOXIE_TOKEN_DECIMALS,
                                            callback,
                                            state.agentWalletBalance,
                                            walletClient
                                        );
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] buyAmountInWEI: ${buyAmountInWEI}`
                                        );
                                    } catch (error) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] Error swapping to MOXIE: ${error}`
                                        );
                                        return true;
                                    }
                                    // execute buy action
                                    const swapResp = await executeBuyAction(
                                        traceId,
                                        moxieUserId,
                                        provider,
                                        agentWallet.address,
                                        buyTokenSubjectAddress,
                                        buyAmountInWEI,
                                        callback,
                                        walletClient,
                                        buyTokenSubjectTokenDetails.name
                                    );
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] executeSellAction response: ${JSON.stringify(swapResp)}`
                                    );

                                    if (swapResp.success == false) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] executeSellAction failed: ${JSON.stringify(swapResp)}`
                                        );
                                        return true;
                                    }
                                    elizaLogger.debug(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [DEFAULT] swap response - buyAmountInWEI: ${buyAmountInWEI}`
                                    );
                                }
                            }
                        } else if (balance && balance.type) {
                            // balance based swap
                            elizaLogger.debug(
                                traceId,
                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] balance type: ${JSON.stringify(balance)}`
                            );
                            try {
                                const result =
                                    await getTargetQuantityForBalanceBasedSwaps(
                                        traceId,
                                        currentWalletBalanceForBalanceBasedSwaps[
                                            sellTokenAddress
                                        ],
                                        moxieUserId,
                                        sellTokenAddress,
                                        sellTokenSymbol,
                                        agentWallet,
                                        balance,
                                        callback
                                    );
                                quantityInWEI = result.quantityInWEI;
                                currentWalletBalanceForBalanceBasedSwaps[
                                    sellTokenAddress
                                ] = result.currentWalletBalance;
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] quantityInWEI: ${quantityInWEI}`
                                );

                                if (sellTokenSymbol !== "MOXIE") {
                                    try {
                                        // execute swap to the requested buy token
                                        const buyAmountInWEI = await swap(
                                            traceId,
                                            MOXIE_TOKEN_ADDRESS,
                                            MOXIE,
                                            sellTokenAddress,
                                            sellTokenSymbol,
                                            moxieUserId,
                                            agentWallet.address,
                                            quantityInWEI,
                                            provider,
                                            sellTokenDecimals,
                                            MOXIE_TOKEN_DECIMALS,
                                            callback,
                                            state.agentWalletBalance,
                                            walletClient
                                        );
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] [MOXIE] buyAmountInWEI: ${buyAmountInWEI}`
                                        );
                                        quantityInWEI = buyAmountInWEI;
                                    } catch (error) {
                                        elizaLogger.error(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] [MOXIE] Error swapping to MOXIE: ${error}`
                                        );
                                        return true;
                                    }
                                }
                                // execute buy action
                                const swapResp = await executeBuyAction(
                                    traceId,
                                    moxieUserId,
                                    provider,
                                    agentWallet.address,
                                    buyTokenSubjectAddress,
                                    quantityInWEI,
                                    callback,
                                    walletClient,
                                    buyTokenSubjectTokenDetails.name
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] executeBuyAction response: ${JSON.stringify(swapResp)}`
                                );

                                if (swapResp.success == false) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] executeBuyAction failed: ${JSON.stringify(swapResp)}`
                                    );
                                    return true;
                                }
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] swap response: ${JSON.stringify(swapResp)}`
                                );
                            } catch (error) {
                                elizaLogger.error(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CREATOR_TO_TOKEN] [BALANCE_BASED] Error getting balance based quantity: ${error}`
                                );
                                return true;
                            }
                        }
                    } else if (swapType == "TOKEN_TO_TOKEN") {
                        const sellTokenDecimals =
                            sellTokenSymbol === "ETH"
                                ? 18
                                : await getERC20Decimals(
                                      traceId,
                                      sellTokenAddress
                                  );

                        const buyTokenDecimals =
                            buyTokenSymbol === "ETH"
                                ? 18
                                : await getERC20Decimals(
                                      traceId,
                                      buyTokenAddress
                                  );

                        let sellQuantityInWEI: bigint;
                        let moxieInWEI: bigint;
                        let quantityInWEI: bigint;

                        elizaLogger.debug(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] swap type: ${swapType}`
                        );
                        if (buyQuantity) {
                            let buyQuantityInWEI = ethers.parseUnits(
                                buyQuantity.toString(),
                                buyTokenDecimals
                            );
                            if (value_type && value_type == "USD") {
                                // this case is for the case where the user is asking to purchase in terms of buy quantity in USD
                                buyQuantityInWEI = ethers.parseUnits(
                                    buyQuantity.toString(),
                                    USDC_TOKEN_DECIMALS
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [VALUE_TYPE]: ${value_type}`
                                );
                                try {
                                    if (sellTokenSymbol != "USDC") {
                                        // dont need to get price if selling USDC
                                        // const price = await get0xPrice({
                                        //     moxieUserId,
                                        //     sellAmountBaseUnits: buyQuantityInWEI.toString(),
                                        //     buyTokenAddress: sellTokenAddress,
                                        //     walletAddress: agentWallet.address,
                                        //     sellTokenAddress: USDC_ADDRESS,
                                        // });

                                        // use codex to get the price
                                        const price = await getPrice(
                                            traceId,
                                            moxieUserId,
                                            buyQuantityInWEI.toString(),
                                            USDC_ADDRESS,
                                            USDC_TOKEN_DECIMALS,
                                            USDC,
                                            sellTokenAddress,
                                            sellTokenDecimals,
                                            sellTokenSymbol
                                        );
                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] price from getUSDEquivalentPrice: ${price}`
                                        );
                                        buyQuantityInWEI = BigInt(price);

                                        elizaLogger.debug(
                                            traceId,
                                            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] buyQuantityInWEI: ${buyQuantityInWEI}`
                                        );
                                    }

                                    if (sellTokenSymbol != buyTokenSymbol) {
                                        try {
                                            // swap to the requested buy token
                                            const buyAmountInWEI = await swap(
                                                traceId,
                                                buyTokenAddress,
                                                buyTokenSymbol,
                                                sellTokenAddress,
                                                sellTokenSymbol,
                                                moxieUserId,
                                                agentWallet.address,
                                                buyQuantityInWEI,
                                                provider,
                                                sellTokenDecimals,
                                                buyTokenDecimals,
                                                callback,
                                                state.agentWalletBalance,
                                                walletClient
                                            );
                                            elizaLogger.debug(
                                                traceId,
                                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] buyAmountInWEI: ${buyAmountInWEI}`
                                            );
                                            buyQuantityInWEI = buyAmountInWEI;
                                        } catch (error) {
                                            elizaLogger.error(
                                                traceId,
                                                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] Error swapping to MOXIE: ${error}`
                                            );
                                            return true;
                                        }
                                    }
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] [USD_VALUE_TYPE] Error getting price: ${error}`
                                    );
                                    return true;
                                }
                            } else {
                                //This gets how much sell token is required to buy the buy token
                                // const price = await get0xPrice({
                                //     moxieUserId,
                                //     sellAmountBaseUnits: buyQuantityInWEI.toString(),
                                //     buyTokenAddress: sellTokenAddress,
                                //     walletAddress: agentWallet.address,
                                //     sellTokenAddress: buyTokenAddress,
                                // });

                                // use codex to get the price
                                const price = await getPrice(
                                    traceId,
                                    moxieUserId,
                                    buyQuantityInWEI.toString(),
                                    buyTokenAddress,
                                    buyTokenDecimals,
                                    buyTokenSymbol,
                                    sellTokenAddress,
                                    sellTokenDecimals,
                                    sellTokenSymbol
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] price from getUSDEquivalentPrice: ${price}`
                                );

                                const currentSellTokenBalanceInWEI =
                                    sellTokenSymbol === "ETH"
                                        ? await getNativeTokenBalance(
                                              traceId,
                                              agentWallet.address
                                          )
                                        : await getERC20Balance(
                                              traceId,
                                              sellTokenAddress,
                                              agentWallet.address
                                          );
                                if (
                                    BigInt(currentSellTokenBalanceInWEI) <
                                    BigInt(price)
                                ) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] insufficient balance: ${currentSellTokenBalanceInWEI} < ${Number(price)}`
                                    );

                                    await handleInsufficientBalance(
                                        traceId,
                                        state.agentWalletBalance,
                                        moxieUserId,
                                        sellTokenAddress,
                                        sellTokenSymbol,
                                        BigInt(price),
                                        BigInt(currentSellTokenBalanceInWEI),
                                        sellTokenDecimals,
                                        agentWallet.address,
                                        callback,
                                        buyTokenAddress
                                    );
                                    return true;
                                }
                                try {
                                    await swap(
                                        traceId,
                                        buyTokenAddress,
                                        buyTokenSymbol,
                                        sellTokenAddress,
                                        sellTokenSymbol,
                                        moxieUserId,
                                        agentWallet.address,
                                        BigInt(price),
                                        provider,
                                        sellTokenDecimals,
                                        buyTokenDecimals,
                                        callback,
                                        state.agentWalletBalance,
                                        walletClient
                                    );
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BUY_QUANTITY] Error swapping to MOXIE: ${error}`
                                    );
                                    return true;
                                }
                            }
                        } else if (sellQuantity) {
                            if (
                                value_type &&
                                value_type == "USD" &&
                                sellTokenAddress !== USDC_ADDRESS
                            ) {
                                const sellQuantityInUSDWEI = ethers.parseUnits(
                                    sellQuantity.toString(),
                                    6
                                );
                                // const priceOfSellTokenFromUSDInWei = await get0xPrice({
                                //     moxieUserId,
                                //     sellAmountBaseUnits: sellQuantityInUSDWEI.toString(),
                                //     buyTokenAddress: sellTokenAddress,
                                //     walletAddress: agentWallet.address,
                                //     sellTokenAddress: USDC_ADDRESS,
                                // });

                                // use codex to get the price
                                const priceOfSellTokenFromUSDInWei =
                                    await getPrice(
                                        traceId,
                                        moxieUserId,
                                        sellQuantityInUSDWEI.toString(),
                                        USDC_ADDRESS,
                                        USDC_TOKEN_DECIMALS,
                                        USDC,
                                        sellTokenAddress,
                                        sellTokenDecimals,
                                        sellTokenSymbol
                                    );

                                const sellQuantityInWEI = BigInt(
                                    priceOfSellTokenFromUSDInWei
                                );
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [SELL_QUANTITY] [USD_VALUE_TYPE] priceOfSellTokenFromUSDInWei: ${priceOfSellTokenFromUSDInWei}`
                                );

                                //Check if the user has enough balance to buy the buy token
                                const currentSellTokenBalanceInWEI =
                                    sellTokenSymbol === "ETH"
                                        ? await getNativeTokenBalance(
                                              traceId,
                                              agentWallet.address
                                          )
                                        : await getERC20Balance(
                                              traceId,
                                              sellTokenAddress,
                                              agentWallet.address
                                          );
                                if (
                                    BigInt(currentSellTokenBalanceInWEI) <
                                    sellQuantityInWEI
                                ) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [SELL_QUANTITY] [USD_VALUE_TYPE] insufficient balance: ${currentSellTokenBalanceInWEI} < ${Number(priceOfSellTokenFromUSDInWei)}`
                                    );
                                    await callback({
                                        text: `\nInsufficient ${sellTokenSymbol} balance\n\nCurrent balance: ${ethers.formatUnits(currentSellTokenBalanceInWEI, sellTokenDecimals)} ${sellTokenSymbol}\nRequired amount: ${ethers.formatUnits(sellQuantityInWEI, sellTokenDecimals)} ${sellTokenSymbol}\n\nPlease add ${ethers.formatUnits(sellQuantityInWEI - BigInt(currentSellTokenBalanceInWEI), sellTokenDecimals)} ${sellTokenSymbol} to continue.`,
                                    });
                                    return true;
                                }

                                try {
                                    await swap(
                                        traceId,
                                        buyTokenAddress,
                                        buyTokenSymbol,
                                        sellTokenAddress,
                                        sellTokenSymbol,
                                        moxieUserId,
                                        agentWallet.address,
                                        BigInt(sellQuantityInWEI),
                                        provider,
                                        sellTokenDecimals,
                                        buyTokenDecimals,
                                        callback,
                                        state.agentWalletBalance,
                                        walletClient
                                    );
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [SELL_QUANTITY] [USD_VALUE_TYPE] Error swapping to MOXIE: ${error}`
                                    );
                                    return true;
                                }
                            } else {
                                const sellQuantityInWEI = ethers.parseUnits(
                                    sellQuantity.toString(),
                                    sellTokenDecimals
                                );
                                const currentSellTokenBalanceInWEI =
                                    sellTokenSymbol === "ETH"
                                        ? await getNativeTokenBalance(
                                              traceId,
                                              agentWallet.address
                                          )
                                        : await getERC20Balance(
                                              traceId,
                                              sellTokenAddress,
                                              agentWallet.address
                                          );
                                if (
                                    BigInt(currentSellTokenBalanceInWEI) <
                                    sellQuantityInWEI
                                ) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [SELL_QUANTITY] insufficient balance: ${currentSellTokenBalanceInWEI} < ${Number(sellQuantityInWEI)}`
                                    );
                                    await callback({
                                        text: `\nInsufficient ${sellTokenSymbol} balance to complete this transaction.\n\nCurrent balance: ${ethers.formatUnits(currentSellTokenBalanceInWEI, sellTokenDecimals)} ${sellTokenSymbol}\nRequired amount: ${ethers.formatUnits(sellQuantityInWEI, sellTokenDecimals)} ${sellTokenSymbol}\n\nPlease add ${ethers.formatUnits(sellQuantityInWEI - BigInt(currentSellTokenBalanceInWEI), sellTokenDecimals)} ${sellTokenSymbol} and try again.`,
                                    });
                                    return true;
                                }
                                try {
                                    await swap(
                                        traceId,
                                        buyTokenAddress,
                                        buyTokenSymbol,
                                        sellTokenAddress,
                                        sellTokenSymbol,
                                        moxieUserId,
                                        agentWallet.address,
                                        BigInt(sellQuantityInWEI),
                                        provider,
                                        sellTokenDecimals,
                                        buyTokenDecimals,
                                        callback,
                                        state.agentWalletBalance,
                                        walletClient
                                    );
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [SELL_QUANTITY] Error swapping to MOXIE: ${error}`
                                    );
                                    return true;
                                }
                            }
                        } else if (balance && balance.type) {
                            try {
                                const result =
                                    await getTargetQuantityForBalanceBasedSwaps(
                                        traceId,
                                        currentWalletBalanceForBalanceBasedSwaps[
                                            sellTokenAddress
                                        ],
                                        moxieUserId,
                                        sellTokenAddress,
                                        sellTokenSymbol,
                                        agentWallet,
                                        balance,
                                        callback
                                    );
                                quantityInWEI = result.quantityInWEI;
                                currentWalletBalanceForBalanceBasedSwaps[
                                    sellTokenAddress
                                ] = result.currentWalletBalance;

                                try {
                                    await swap(
                                        traceId,
                                        buyTokenAddress,
                                        buyTokenSymbol,
                                        sellTokenAddress,
                                        sellTokenSymbol,
                                        moxieUserId,
                                        agentWallet.address,
                                        quantityInWEI,
                                        provider,
                                        sellTokenDecimals,
                                        buyTokenDecimals,
                                        callback,
                                        state.agentWalletBalance,
                                        walletClient
                                    );
                                } catch (error) {
                                    elizaLogger.error(
                                        traceId,
                                        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BALANCE_BASED] Error swapping to MOXIE: ${error}`
                                    );
                                    return true;
                                }
                                elizaLogger.debug(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BALANCE_BASED] quantityInWEI: ${quantityInWEI}`
                                );
                            } catch (error) {
                                elizaLogger.error(
                                    traceId,
                                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [TOKEN_TO_TOKEN] [BALANCE_BASED] Error getting balance based quantity: ${error}`
                                );
                                return true;
                            }
                        }

                        // check if stop loss is enabled
                    }
                }
                // delete the cache
                const cacheKey = `PORTFOLIO-${moxieUserId}`;
                await runtime.cacheManager.delete(cacheKey);
                elizaLogger.debug(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [SWAP] [CACHE] deleted cache key: ${cacheKey}`
                );
            }
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
            // else {
            //     await callback?.(swapOperationFailedTemplate(error));
            // }
            return true;
        }
    },
    template: tokenSwapTemplate,
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        // if (message.content.text.toLowerCase().includes("@[")) {
        //     return true;
        // }
        // return false;
        return true;
    },
    examples: [],
    similes: [
        "CREATOR_TOKEN_SWAP",
        "CREATOR_COIN_SWAP",
        "EXCHANGE_CREATOR_COINS",
        "TRADE_CREATOR_TOKENS",
        "BUY_CREATOR_TOKENS",
        "BUY_CREATOR_COINS",
        "PURCHASE_CREATOR_COINS",
        "PURCHASE_ERC20_TOKENS",
        "SWAP_ERC20_TOKENS",
    ],
};

async function isValidSwapContent(
    traceId: string,
    moxieUserId: string,
    content: TokenSwapResponse,
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
            `[tokenSwap] [${moxieUserId}] [isValidSwapContent] Invalid content structure: ${JSON.stringify(content)}`
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
        if (
            !transaction.sellToken ||
            !transaction.buyToken ||
            (!transaction.balance &&
                !transaction.buyQuantity &&
                !transaction.sellQuantity)
        ) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [isValidSwapContent] Missing required fields in transaction: ${JSON.stringify(transaction)}`
            );
            await callback?.({
                text: "\nAn error occurred while processing your request. Please try again.",
                content: {
                    error: "MISSING_FIELDS",
                    details:
                        "An error occurred while processing your request. Please try again.",
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
                `[tokenSwap] [${moxieUserId}] [isValidSwapContent] Invalid quantity: sellQuantity=${transaction.sellQuantity}, buyQuantity=${transaction.buyQuantity}`
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
                !transaction.balance.source_token ||
                !transaction.balance.type ||
                (transaction.balance.type === "PERCENTAGE" &&
                    (transaction.balance.percentage <= 0 ||
                        transaction.balance.percentage > 100))
            ) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [isValidSwapContent] Invalid balance configuration: ${JSON.stringify(transaction.balance)}`
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

    // check if stop loss is enabled
    if (content.stop_loss && content.stop_loss.percentage) {
        if (content.stop_loss.percentage <= 0 || content.stop_loss.percentage > 100) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [isValidSwapContent] Invalid stop loss percentage: ${content.stop_loss.percentage}`
            );
            await callback?.({
                text: "\nStop loss percentage must be between 0 and 100."
            });
            return false;
        }
    }

    return true;
}

interface Balance {
    source_token: string;
    type: "FULL" | "PERCENTAGE";
    percentage: number;
}

interface SwapTransaction {
    sellToken: string;
    buyToken: string;
    sellQuantity: number | null;
    buyQuantity: number | null;
    value_type?: "USD";
    balance?: {
        source_token: string;
        type: "FULL" | "PERCENTAGE";
        percentage: number;
    };
}

interface StopLoss {
    percentage: number | null;
}

interface TokenSwapResponse {
    success: boolean;
    action: "BUY" | "SELL" | "SWAP";
    transaction_type: "DIRECT" | "BALANCE_BASED" | "MULTI_CREATOR";
    is_followup: boolean;
    transactions: SwapTransaction[];
    stop_loss?: StopLoss;
    error?: {
        missing_fields: string[];
        prompt_message: string;
    };
    confirmation_required: boolean;
    confirmation_message?: string;
}

/**
 * Swaps tokens using 0x protocol
 * @param buyTokenAddress The address of the token to buy
 * @param buyTokenSymbol The symbol of the token to buy
 * @param sellTokenAddress The address of the token to sell
 * @param sellTokenSymbol The symbol of the token to sell
 * @param moxieUserId The user ID of the person performing the swap
 * @param agentWalletAddress The wallet address of the person performing the swap
 * @param sellAmountInWEI The amount of the token to sell in WEI
 * @param provider The ethers JsonRpcProvider instance
 * @param sellTokenDecimals The number of decimals of the token to sell
 * @param buyTokenDecimals The number of decimals of the token to buy
 * @param callback Optional callback function to receive status updates
 */
async function swap(
    traceId: string,
    buyTokenAddress: string,
    buyTokenSymbol: string,
    sellTokenAddress: string,
    sellTokenSymbol: string,
    moxieUserId: string,
    agentWalletAddress: string,
    sellAmountInWEI: bigint,
    provider: ethers.JsonRpcProvider,
    sellTokenDecimals: number,
    buyTokenDecimals: number,
    callback: any,
    agentWalletBalance,
    walletClient: MoxieWalletClient
): Promise<bigint> {
    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [swap] called, buyTokenAddress: ${buyTokenAddress}, buyTokenSymbol: ${buyTokenSymbol}, sellTokenAddress: ${sellTokenAddress}, sellTokenSymbol: ${sellTokenSymbol}, agentWalletAddress: ${agentWalletAddress}, sellAmountInWEI: ${sellAmountInWEI}`
    );
    let buyAmountInWEI: bigint;
    let tokenBalance: bigint;
    let quote: GetQuoteResponse | null = null;
    try {
        // do balance check first
        const balance =
            sellTokenSymbol === "ETH"
                ? await provider.getBalance(agentWalletAddress)
                : await getERC20Balance(
                      traceId,
                      sellTokenAddress,
                      agentWalletAddress
                  );
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] balance: ${balance}`
        );
        tokenBalance = balance ? BigInt(balance) : BigInt(0);

        if (tokenBalance < sellAmountInWEI) {
            await handleInsufficientBalance(
                traceId,
                agentWalletBalance,
                moxieUserId,
                sellTokenAddress,
                sellTokenSymbol,
                sellAmountInWEI,
                tokenBalance,
                sellTokenDecimals,
                agentWalletAddress,
                callback,
                buyTokenAddress
            );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] Insufficient balance for ${sellTokenSymbol} to ${buyTokenSymbol} swap. Token balance: ${tokenBalance}, required: ${sellAmountInWEI}`
            );
            throw new Error(
                `[tokenSwap] [${moxieUserId}] [swap] Insufficient balance for ${sellTokenSymbol} to ${buyTokenSymbol} swap. Token balance: ${tokenBalance}, required: ${sellAmountInWEI}`
            );
        }

        // call 0x api to get quote
        quote = await get0xSwapQuote({
            traceId: traceId,
            moxieUserId: moxieUserId,
            sellAmountBaseUnits: sellAmountInWEI.toString(),
            buyTokenAddress: buyTokenAddress,
            buyTokenSymbol: buyTokenSymbol,
            walletAddress: agentWalletAddress,
            sellTokenAddress: sellTokenAddress,
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
            await callback?.({
                text: `\nInsufficient liquidity to complete this transaction. Please try with a smaller amount.`,
            });
            throw new Error(
                `[tokenSwap] [${moxieUserId}] [swap] Insufficient liquidity for ${sellTokenSymbol} to ${buyTokenSymbol} swap`
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
                callback
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
                          traceId,
                          sellTokenAddress,
                          agentWalletAddress
                      );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] tokenBalance: ${balance}`
            );
            if (balance) {
                tokenBalance = BigInt(balance);
            }
            if (tokenBalance < sellAmountInWEI) {
                await handleInsufficientBalance(
                    traceId,
                    agentWalletBalance,
                    moxieUserId,
                    sellTokenAddress,
                    sellTokenSymbol,
                    sellAmountInWEI,
                    tokenBalance,
                    sellTokenDecimals,
                    agentWalletAddress,
                    callback,
                    buyTokenAddress
                );
                elizaLogger.debug(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [swap] Insufficient balance for ${sellTokenSymbol} to ${buyTokenSymbol} swap. Token balance: ${tokenBalance}, required: ${sellAmountInWEI}`
                );
                throw new Error(
                    `Insufficient balance for ${sellTokenSymbol} to ${buyTokenSymbol} swap. Token balance: ${tokenBalance}, required: ${sellAmountInWEI}`
                );
            }
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error getting 0x quote: ${error.message}`
        );

        // Check for specific error in multiple possible locations
        const errorData =
            error.data ||
            (error.responseJSON &&
                error.responseJSON.error &&
                error.responseJSON.error.data);
        const errorName = errorData?.name || "";
        // check for buy token not authorized for trade
        if (
            errorName === "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE" ||
            (error.message &&
                error.message.includes("BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE"))
        ) {
            await callback?.({
                text: `\nThe buy token: ${buyTokenSymbol} is not supported yet. Please try with a different token.`,
            });
        } else {
            if (!error.message?.includes("Insufficient balance")) {
                await callback?.({
                    text: `\nAn error occurred while processing your request. Please try again.`,
                    content: {
                        details: `An error occurred while processing your request. Please try again.`,
                    },
                });
            }
        }
        throw new Error(
            `[tokenSwap] [${moxieUserId}] [swap] Error getting 0x quote: ${error.message}`
        );
    }

    // if (sellTokenSymbol != "ETH") { // skip for ETH
    // signature related
    let signResponse: MoxieWalletSignTypedDataResponseType | undefined;
    try {
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] quote.permit2.eip712: ${JSON.stringify(quote.permit2?.eip712)}`
        );
        if (quote.permit2?.eip712) {
            const MAX_RETRIES = 3;
            let retryCount = 0;
            let lastError: any;

            while (retryCount < MAX_RETRIES) {
                try {
                    elizaLogger.debug(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [swap] Signing attempt ${retryCount + 1} of ${MAX_RETRIES}`
                    );

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
                    break; // Success, exit the retry loop
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    const errorMessage =
                        error instanceof Error
                            ? error.message
                            : "Unknown error";
                    elizaLogger.warn(
                        traceId,
                        `[tokenSwap] [${moxieUserId}] [swap] Error signing on attempt ${retryCount}: ${errorMessage}`
                    );

                    if (retryCount < MAX_RETRIES) {
                        // Exponential backoff
                        const delay = 1000 * Math.pow(2, retryCount);
                        elizaLogger.debug(
                            traceId,
                            `[tokenSwap] [${moxieUserId}] [swap] Retrying signing in ${delay}ms...`
                        );
                        await new Promise((resolve) =>
                            setTimeout(resolve, delay)
                        );
                    } else {
                        throw error; // Re-throw the last error after all retries fail
                    }
                }
            }
        }

        if (signResponse && signResponse.signature && quote.transaction?.data) {
            const signatureLengthInHex = numberToHex(
                size(signResponse.signature as MoxieHex),
                {
                    signed: false,
                    size: 32,
                }
            );
            // Append signature length and data to transaction
            quote.transaction.data = concat([
                quote.transaction.data,
                signatureLengthInHex,
                signResponse.signature,
            ]);
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] quote.transaction.data: ${JSON.stringify(quote.transaction.data)}`
            );
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error signing typed data after retries: ${JSON.stringify(error)}`
        );
        await callback?.({
            text: `\nAn error occurred while processing your request. Please try again.`,
            content: {
                error: "SIGN_TYPED_DATA_FAILED",
                details: `An error occurred while processing your request. Please try again.`,
            },
        });
    }
    // }

    // execute 0x swap
    let tx: MoxieWalletSendTransactionResponseType | null = null;
    try {
        tx = await execute0xSwap({
            traceId: traceId,
            moxieUserId: moxieUserId,
            walletAddress: agentWalletAddress,
            quote: quote,
            walletClient: walletClient,
        });
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] 0x tx: ${JSON.stringify(tx)}`
        );
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error executing 0x swap: ${JSON.stringify(error)}`
        );
        await callback?.({
            text: `\nSorry, the swap you requested has failed at this time. Please try again.\nIf the issue persists, tap the 👎 button to report this issue, or contact our team in the [Senpi Dojo Telegram Group](${process.env.SENPI_TELEGRAM_GROUP_URL}) for further assistance. 🙏`,
            content: {
                error: `${sellTokenSymbol}_TO_${buyTokenSymbol}_SWAP_FAILED`,
                details: `An error occurred while processing your request. Please try again.`,
            },
        });
        throw new Error(
            `[tokenSwap] [${moxieUserId}] [swap] Error executing 0x swap: ${JSON.stringify(error)}`
        );
    }

    await callback?.(
        swapInProgressTemplate(
            sellTokenSymbol,
            sellTokenAddress,
            buyTokenSymbol,
            buyTokenAddress,
            tx.hash
        )
    );

    // wait for tx to be mined
    let txnReceipt: ethers.TransactionReceipt | null;
    try {
        txnReceipt = await handleTransactionStatus(
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
            await callback?.({
                text: `\nTransaction verification timed out. Please check [BaseScan](https://basescan.org/tx/${tx.hash}) to verify the status before retrying.`,
                content: {
                    url: `https://basescan.org/tx/${tx.hash}`,
                },
            });
            throw new Error("Transaction verification timed out");
        }
        if (txnReceipt.status == 1) {
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] txnReceipt: ${JSON.stringify(txnReceipt)}`
            );
        } else {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] txnReceipt status is not 1: ${JSON.stringify(txnReceipt)}`
            );
            await callback?.({
                text: `\nTransaction is failed. Please try again`,
                content: {
                    error: "TRANSACTION_FAILED",
                    details: `Transaction failed. Please try again.`,
                },
            });
            throw new Error("Transaction failed");
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error handling transaction status: ${JSON.stringify(error)}`
        );
        await callback?.({
            text: `\nAn error occurred while processing your request. Please try again.`,
            content: {
                error: "TRANSACTION_FAILED",
                details: `An error occurred while processing your request. Please try again.`,
            },
        });
        return buyAmountInWEI;
    }

    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [swap] 0x swap txnReceipt: ${JSON.stringify(txnReceipt)}`
    );
    if (txnReceipt.status == 1) {
        if (
            buyTokenAddress.toLowerCase() !== ETH_ADDRESS.toLowerCase() &&
            buyTokenAddress.toLowerCase() !== WETH_ADDRESS.toLowerCase()
        ) {
            // decode the txn receipt to get the moxie purchased
            const transferDetails = await decodeTokenTransfer(
                traceId,
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
                await callback?.({
                    text: `\nAn error occurred while processing your request. Please try again.`,
                    content: {
                        error: "TOKEN_DECODE_ERROR",
                        details: `An error occurred while processing your request. Please try again.`,
                    },
                });
                return buyAmountInWEI;
            }
        }

        await callback?.(
            swapCompletedTemplate(
                sellTokenSymbol,
                sellTokenAddress,
                buyTokenSymbol,
                buyTokenAddress,
                buyAmountInWEI,
                buyTokenDecimals
            )
        );
        return buyAmountInWEI;
    } else {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] 0x swap failed: ${tx.hash} `
        );
        await callback?.({
            text: `\nAn error occurred while processing your request. Please try again.`,
            content: {
                error: `${sellTokenSymbol}_TO_${buyTokenSymbol}_SWAP_FAILED`,
                details: `An error occurred while processing your request. Please try again.`,
            },
        });
        return buyAmountInWEI;
    }
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
    balance: Balance,
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
        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [getTargetQuantityForBalanceBasedSwaps] currentWalletBalance: ${currentWalletBalance} ${sellTokenAddress}`
    );
    if (!currentWalletBalance || currentWalletBalance === 0n) {
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [balance] currentWalletBalance is ${currentWalletBalance}`
        );
        await callback?.({
            text: `\nYour agent wallet doesn't have any ${sellTokenSymbol} balance to complete this operation.`,
        });
        throw new Error(
            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [balance] currentWalletBalance is ${currentWalletBalance}`
        );
    }

    // calculate the percentage to be used for the swap
    let percentage = balance.type === "FULL" ? 100 : balance.percentage;

    // If ETH and 100%, use 99% instead
    if (sellTokenSymbol === "ETH" && percentage === 100) {
        percentage = 99;
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [balance] Using 99% instead of 100% for ETH`
        );
    }

    // Scale up by a larger factor (e.g., 1e7)
    quantityInWEI =
        (BigInt(currentWalletBalance) * BigInt(percentage * 1e7)) / BigInt(1e9);
    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [tokenSwapAction] [balance] quantityInWEI: ${quantityInWEI}`
    );
    return { quantityInWEI, currentWalletBalance };
}

/**
 * Fetches FTA responses for given creator IDs
 * @param creatorIds - Array of creator IDs to fetch FTA responses for
 * @param moxieUserId - The user ID of the person performing the swap
 * @param runtime - The runtime environment
 * @param callback - The callback function to receive status updates
 * @returns Promise that resolves to a record of creator IDs and their FTA responses
 */
async function getFtaResponses(
    traceId: string,
    creatorIds: string[],
    moxieUserId: string,
    runtime: any,
    callback: HandlerCallback
): Promise<Record<string, any>> {
    const ftaResponses: Record<string, any> = {};
    for (const creatorId of creatorIds) {
        const ftaResponse = await runtime.cacheManager.get(
            `userftadetails-${creatorId}`
        );
        if (ftaResponse) {
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] fta response fetched successfully from cache for creator moxie user id: ${creatorId}, ${JSON.stringify(ftaResponse)}`
            );
            ftaResponses[creatorId] = ftaResponse;
        } else {
            const newFtaResponse = await ftaService.getUserFtaData(creatorId);
            if (!newFtaResponse || newFtaResponse == null) {
                elizaLogger.error(
                    traceId,
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] fta response not found for creator ${creatorId}`
                );
                await callback?.({
                    text: `\nUnfortunately, the user you are querying has not launched a creator coin yet. Creator coins are required to analyze user data using the Moxie AI Agent.`,
                });
                throw new Error(
                    `[tokenSwap] [${moxieUserId}] [tokenSwapAction] The creator with ID ${creatorId} could not be found. Please verify the creator ID`
                );
            }
            await runtime.cacheManager.set(
                `userftadetails-${creatorId}`,
                newFtaResponse
            );
            ftaResponses[creatorId] = newFtaResponse;
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [tokenSwapAction] fta response fetched successfully for creator ${creatorId} and set in cache`
            );
        }
    }
    return ftaResponses;
}

/**
 * Get the creator coin details
 * @param isSellTokenCreatorCoin - Whether the sell token is a creator coin
 * @param isBuyTokenCreatorCoin - Whether the buy token is a creator coin
 * @param sellTokenAddress - The address of the sell token
 * @param buyTokenAddress - The address of the buy token
 * @param sellTokenCreatorId - The creator ID of the sell token
 * @param buyTokenCreatorId - The creator ID of the buy token
 * @param subjectTokenDetails - The subject token details
 * @param moxieUserId - The user ID of the person performing the swap
 * @param runtime - The runtime environment
 * @param callback - The callback function to receive status updates
 * @returns Promise that resolves to the creator coin details
 */
async function getCreatorCoinDetails(
    traceId: string,
    isSellTokenCreatorCoin: boolean,
    isBuyTokenCreatorCoin: boolean,
    sellTokenAddress: string,
    buyTokenAddress: string,
    sellTokenCreatorId: string,
    buyTokenCreatorId: string,
    subjectTokenDetails: { [key: string]: SubjectToken },
    moxieUserId: string,
    runtime: any,
    callback?: any
): Promise<{
    sellTokenSubjectTokenDetails: SubjectToken;
    buyTokenSubjectTokenDetails: SubjectToken;
}> {
    let sellTokenSubjectTokenDetails: SubjectToken;
    let buyTokenSubjectTokenDetails: SubjectToken;

    // Get creator IDs only for non-creator coins
    const creatorIds = [];
    if (!isSellTokenCreatorCoin && sellTokenCreatorId) {
        creatorIds.push(sellTokenCreatorId);
    }
    if (!isBuyTokenCreatorCoin && buyTokenCreatorId) {
        creatorIds.push(buyTokenCreatorId);
    }

    // If we need to fetch any FTA details
    if (creatorIds.length > 0) {
        let ftaResponses: { [key: string]: any } = {};
        try {
            ftaResponses = await getFtaResponses(
                traceId,
                creatorIds,
                moxieUserId,
                runtime,
                callback
            );
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [getCreatorCoinDetails] Error getting FTA responses for creator IDs ${creatorIds.join(", ")}: ${error}`
            );
            throw error;
        }

        // Only get subject addresses for tokens that need them
        if (!isSellTokenCreatorCoin && sellTokenCreatorId) {
            const sellTokenSubjectAddress =
                ftaResponses[sellTokenCreatorId]?.subjectAddress;
            if (!sellTokenSubjectAddress) {
                throw new Error(
                    `No subject address found for sell token creator ${sellTokenCreatorId}`
                );
            }
            sellTokenSubjectTokenDetails =
                await getSubjectTokenDetailsBySubjectAddress(
                    traceId,
                    sellTokenSubjectAddress
                );
        }

        if (!isBuyTokenCreatorCoin && buyTokenCreatorId) {
            const buyTokenSubjectAddress =
                ftaResponses[buyTokenCreatorId].subjectAddress;
            if (!buyTokenSubjectAddress) {
                throw new Error(
                    `No subject address found for buy token creator ${buyTokenCreatorId}`
                );
            }
            buyTokenSubjectTokenDetails =
                await getSubjectTokenDetailsBySubjectAddress(
                    traceId,
                    buyTokenSubjectAddress
                );
        }
    }

    // Set creator coin details from subjectTokenDetails if they are creator coins
    if (isSellTokenCreatorCoin) {
        sellTokenSubjectTokenDetails = subjectTokenDetails[sellTokenAddress];
    }
    if (isBuyTokenCreatorCoin) {
        buyTokenSubjectTokenDetails = subjectTokenDetails[buyTokenAddress];
    }

    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [getCreatorCoinDetails]  [SELL_TOKEN_DETAILS]: ${JSON.stringify(sellTokenSubjectTokenDetails)}`
    );
    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [getCreatorCoinDetails]  [BUY_TOKEN_DETAILS]: ${JSON.stringify(buyTokenSubjectTokenDetails)}`
    );

    // Before returning, validate both values exist
    // if (!sellTokenSubjectTokenDetails && !buyTokenSubjectTokenDetails) {
    //     throw new Error('Failed to get any subject token details');
    // }

    return {
        sellTokenSubjectTokenDetails,
        buyTokenSubjectTokenDetails,
    };
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
        // const priceResponse = await get0xPrice({
        //     moxieUserId,
        //     sellAmountBaseUnits: sellAmountInWEI.toString(),
        //     buyTokenAddress: USDC_ADDRESS,
        //     walletAddress: agentWalletAddress,
        //     sellTokenAddress: sellTokenAddress,
        // });

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
