import {
    Action,
    composeContext,
    elizaLogger,
    generateObject,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
} from "@moxie-protocol/core";
import { MoxieUser, Portfolio } from "@moxie-protocol/moxie-agent-lib";
import { ActionType, DustRequestSchema, Source } from "../types";
import { dustRequestTemplate } from "../templates";
import { ETH_ADDRESS } from "../constants/constants";
import { createManualOrder } from "../utils/swap";
import { parseUnits } from "ethers";

export const dustWalletAction: Action = {
    name: "DUST_WALLET_TO_ETH",
    similes: [
        "CLEAN_WALLET",
        "DUST_MY_TOKENS",
        "REMOVE_DUST",
        "DUST_TO_ETH",
        "CLEAR_LOW_VALUE_TOKENS",
        "CLEAR_THE_DUST_OUT",
        "SELL_ALL_TOKENS_UNDER",
        "DUST_TOKENS",
        "DUST_WALLET",
        "DUST_TOKENS_UNDER_USD",
        "DUST_TOKENS_BELOW_USD",
    ],
    validate: async () => true,
    description:
        "Dust any low-value ERC20 tokens in the user's agent wallet under a given USD $ value threshold and dusts them to ETH on Base. Select this action when user request to dust their wallet and NOT just simply display/preview the dust tokens, e.g. 'Dust tokens under $5'.",
    suppressInitialMessage: true,
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Dust my wallet for anything under $5." },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Dusted 3 dust tokens into ETH.",
                    action: "DUST_WALLET_TO_ETH",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Dust my wallet" },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Dusted 1 token under $5 into ETH.",
                    action: "DUST_WALLET_TO_ETH",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Dust my agent wallet for tokens under $10 into ETH.",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Dusted 4 tokens under $10 into ETH.",
                    action: "DUST_WALLET_TO_ETH",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Clear all the low-value tokens from my wallet.",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swapped 2 dust tokens into ETH.",
                    action: "DUST_WALLET_TO_ETH",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Dust tokens under $<USD_THRESHOLD>",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Dusted 4 tokens under $<USD_THRESHOLD> into ETH.",
                    action: "DUST_WALLET_TO_ETH",
                },
            },
        ],
    ],
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        options?: { [key: string]: unknown },
        callback?: HandlerCallback
    ) => {
        try {
            const traceId = message.id;
            const moxieUserId = (state?.moxieUserInfo as MoxieUser)?.id;
            elizaLogger.debug(
                traceId,
                `[dustWalletAction] [${moxieUserId}] Starting dusting process`
            );

            const context = composeContext({
                state,
                template: dustRequestTemplate,
            });

            const details = await generateObject({
                runtime,
                context,
                modelClass: ModelClass.SMALL,
                schema: DustRequestSchema,
            });
            elizaLogger.debug(
                traceId,
                `[dustWalletAction] [${moxieUserId}] details: ${JSON.stringify(details?.object)}`
            );
            const extractedValue = details.object as {
                threshold: number;
                isConfirmed: boolean;
            };
            const threshold = extractedValue?.threshold ?? 5;
            const isConfirmed = extractedValue?.isConfirmed;

            if (isConfirmed === null) {
                await callback?.({
                    text: `You are trying to dust tokens under $${threshold} from your agent wallet. Depending on the number of tokens, this may take a several minutes to complete. \n\nDo you want to proceed?`,
                });
                return true;
            } else if (isConfirmed === false) {
                await callback?.({
                    text: "Dusting process cancelled.",
                });
                return true;
            }

            const { tokenBalances }: Portfolio =
                (state?.agentWalletBalance as Portfolio) ?? {
                    tokenBalances: [],
                };
            elizaLogger.debug(
                traceId,
                `[dustWalletAction] [${moxieUserId}] tokenBalances: ${JSON.stringify(tokenBalances)}`
            );
            const dustTokens = tokenBalances.filter(
                (t) =>
                    ((threshold > 0.01 &&
                        t.token.balanceUSD < threshold &&
                        t.token.balanceUSD > 0.01) ||
                        (threshold <= 0.01 &&
                            t.token.balanceUSD < threshold)) &&
                    t.token.balance > 0 &&
                    // ignore ETH
                    t.token.baseToken.address.toLowerCase() !==
                        "0x0000000000000000000000000000000000000000".toLowerCase() &&
                    t.token.baseToken.address.toLowerCase() !==
                        ETH_ADDRESS.toLowerCase()
            );
            elizaLogger.debug(
                traceId,
                `[dustWalletAction] [${moxieUserId}] dustTokens: ${JSON.stringify(dustTokens)}`
            );

            if (!dustTokens.length) {
                await callback?.({
                    text: `No tokens under $${threshold} found in your wallet.${threshold > 0.01 ? `\n\nOnly tokens above $0.01 have been checked for dusting. To dust tokens below $0.01, set the threshold to $0.01 or below.` : ""}`,
                });

                return true;
            }

            await callback?.({
                text: `Initializing dusting process on your agent wallet for tokens under $${threshold}...\n`,
            });

            let totalUsdValue = 0;
            let dustedTokenCount = 0;
            for (const token of dustTokens) {
                const sellTokenDecimal = token.token.baseToken.decimals;

                const balanceInWei = parseUnits(
                    token.token.balance.toString(),
                    sellTokenDecimal
                ).toString();

                const { success } = await createManualOrder(
                    state.authorizationHeader as string,
                    ActionType.SWAP,
                    Source.AGENT,
                    {
                        sellTokenAddress: token.token.baseToken.address,
                        chainId: 8453,
                        buyTokenAddress: ETH_ADDRESS,
                        amount: balanceInWei,
                        buyTokenDecimal: 18,
                        buyTokenSymbol: "ETH",
                        sellTokenDecimal,
                        sellTokenSymbol: token.token.baseToken.symbol,
                    },
                    callback
                );

                if (success) {
                    dustedTokenCount++;
                    totalUsdValue += token.token.balanceUSD;
                }
            }

            await callback?.({
                text: `\nDusted ${dustedTokenCount} dust token${dustedTokenCount === 1 ? "" : "s"} into ETH (${totalUsdValue < 0.01 ? "< $0.01" : `~ $${totalUsdValue.toFixed(2)}`}).${threshold > 0.01 ? `\n\nOnly tokens above $0.01 have been dusted. To dust tokens below $0.01, set the threshold to $0.01 or below.` : ""}`,
            });

            return true;
        } catch (error) {
            elizaLogger.error("Error dusting wallet:", error);
            await callback?.({
                text: "An error occurred while dusting your wallet. Please try again later.",
            });

            return true;
        }
    },
};
