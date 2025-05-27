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
import { DustRequestSchema } from "../types";
import { dustRequestTemplate } from "../templates";
import { ETH_ADDRESS } from "../constants/constants";

export const previewDustAction: Action = {
    name: "PREVIEW_DUST_TOKENS",
    similes: [
        "SHOW_DUST_TOKENS",
        "WHAT_TOKENS_WILL_BE_DUSTED",
        "LIST_LOW_VALUE_TOKENS",
        "SHOW_TOKENS_BELOW_USD",
        "SHOW_TOKENS_BELOW_VALUE",
        "SHOW_TOKENS_BELOW_THRESHOLD",
        "HOW_MUCH_DUST_IN_WALLET",
        "HOW_MANY_DUST_TOKENS_IN_WALLET",
        "WHAT_VALUE_OF_DUST_IN_WALLET",
    ],
    description:
        "Select this action when user request to preview/show how much or how many dust or low-value tokens would be dusted based on USD threshold given by user. By default, the threshold is $5. Use this action if user only ask to preview or display the dust tokens, NOT when user ask to dust the tokens.",
    validate: async () => true,
    suppressInitialMessage: true,
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Preview what tokens you’d dust from my wallet.",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `You have 3 dust token(s) totaling ~$7.85:\n- USDC: ~$2.50\n- PEPE: ~$1.15\n- DINO: ~$4.20`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you show me all the dust tokens I have in my wallets?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `You have 3 dust token(s) totaling ~$7.85:\n- USDC: ~$2.50\n- PEPE: ~$1.15\n- DINO: ~$4.20`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "What tokens will be dusted from my wallet?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `You have 3 dust token(s) totaling ~$7.85:\n- USDC: ~$2.50\n- PEPE: ~$1.15\n- DINO: ~$4.20`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you show me all the dust tokens I have in my wallets?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `You have 3 dust token(s) totaling ~$7.85:\n- USDC: ~$2.50\n- PEPE: ~$1.15\n- DINO: ~$4.20`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you show me all the low-value tokens in my wallet?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `You have 3 dust token(s) totaling ~$7.85:\n- USDC: ~$2.50\n- PEPE: ~$1.15\n- DINO: ~$4.20`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you show me all the dust tokens below $10 in my wallet?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `You have 3 dust token(s) totaling ~$7.85:\n- USDC: ~$2.50\n- PEPE: ~$1.15\n- DINO: ~$4.20`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Preview what tokens you'd dust from my wallet.",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `Preview: You have 4 dust token(s) totaling ~$12.45:\n- 0xabc... (100000 tokens worth ~$2.14)\n- 0xdef... (90000 tokens worth ~$3.20)\n- 0x123... (5000 tokens worth ~$2.08)\n- 0x456... (30000 tokens worth ~$5.03)`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Show me the all the dust tokens in my wallet.",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `Preview: You have 2 dust token(s) totaling ~$6.78:\n- 0x789... (12000 tokens worth ~$3.30)\n- 0xabc... (18000 tokens worth ~$3.48)`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How many dust is in my wallet?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `You have 2 dust token(s) totaling ~$6.78:\n- 0x789... (12000 tokens worth ~$3.30)\n- 0xabc... (18000 tokens worth ~$3.48)`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How many dust tokens are in my wallet?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `You have 2 dust token(s) totaling ~$6.78:\n- 0x789... (12000 tokens worth ~$3.30)\n- 0xabc... (18000 tokens worth ~$3.48)`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How much dust is in my wallet?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `Preview: You have 4 dust token(s) totaling ~$12.45:\n- 0xabc... (100000 tokens worth ~$2.14)\n- 0xdef... (90000 tokens worth ~$3.20)\n- 0x123... (5000 tokens worth ~$2.08)\n- 0x456... (30000 tokens worth ~$5.03)`,
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Preview dusting my wallet",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "You have 1 dust token(s) totaling ~ $0.08: 0x123... (1000 tokens worth $0.08)",
                    action: "PREVIEW_DUST_TOKENS",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "Great! can you dust them all?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "You are trying to dust tokens under $5 from your agent wallet. Depending on the number of tokens, this may take a several minutes to complete. \n\nDo you want to proceed?",
                    action: "DUST_WALLET_TO_ETH",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "Yes, proceed",
                },
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
                    text: "What's the value of dust in my agent wallet?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "You have 1 dust token(s) totaling ~ $0.08: 0x123... (1000 tokens worth $0.08)",
                    action: "PREVIEW_DUST_TOKENS",
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
                `[dustPreview] [${moxieUserId}] Providing preview of dust in user's wallet`
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
                `[dustPreview] [${moxieUserId}] details: ${JSON.stringify(details?.object)}`
            );
            const extractedValue = details.object as {
                threshold: number;
            };
            const threshold = extractedValue?.threshold ?? 5;
            const { tokenBalances }: Portfolio =
                (state.agentWalletBalance as Portfolio) ?? {
                    tokenBalances: [],
                };
            elizaLogger.debug(
                traceId,
                `[dustPreview] [${moxieUserId}] tokenBalances: ${JSON.stringify(tokenBalances)}`
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
                `[dustPreview] [${moxieUserId}] dustTokens: ${JSON.stringify(dustTokens)}`
            );

            if (!dustTokens.length) {
                await callback?.({
                    text: `\nNo tokens under $${threshold} found in your wallet.${threshold > 0.01 ? `\n\nOnly tokens above $0.01 have been shown. To show dust tokens below $0.01, set the threshold to $0.01 or below.` : ""}`,
                });

                return true;
            }

            const totalUsdValue = dustTokens.reduce(
                (sum, token) => sum + token.token.balanceUSD,
                0
            );

            elizaLogger.debug(
                traceId,
                `[dustPreview] [${moxieUserId}] totalUsdValue: ${totalUsdValue}`
            );

            const lines = dustTokens.map(
                (t) =>
                    `| $${t.token.baseToken.symbol} | [${t.token.baseToken.address}](https://basescan.org/token/${t.token.baseToken.address}) | ${t.token.balanceUSD < 0.01 ? "< $0.01" : `$${t.token.balanceUSD.toFixed(2)}`} |`
            );
            const response = `You have ${dustTokens.length} dust token(s) totaling ${totalUsdValue < 0.01 ? "< $0.01" : `~ $${totalUsdValue.toFixed(2)}`}:\n| Token Symbol | Token Address | Value |\n|-------|-------|-------|\n${lines.join("\n")}${threshold > 0.01 ? `\n\nOnly tokens above $0.01 have been displayed. To display tokens below $0.01, set the threshold to $0.01 or below.` : ""}`;

            await callback?.({ text: response });

            return true;
        } catch (error) {
            elizaLogger.error("Error previewing dust:", error);
            await callback?.({
                text: "An error occurred while previewing dust. Please try again later.",
            });

            return true;
        }
    },
};

export default previewDustAction;
