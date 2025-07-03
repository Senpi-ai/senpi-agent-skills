import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    type ActionExample,
    composeContext,
    elizaLogger,
    ModelClass,
    ModelProviderName,
    streamText,
} from "@moxie-protocol/core";
import { template } from "../templates";
import { MoxieUser } from "@moxie-protocol/moxie-agent-lib";
import { getTrendingTokens } from "../utils/codex";

export const trendingTokensAction: Action = {
    name: "TRENDING_TOKENS",
    similes: [],
    description: "Display trending tokens on Base.",
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
            const trendingTokens = await getTrendingTokens();
            if (!trendingTokens || trendingTokens.length === 0) {
                elizaLogger.error(
                    traceId,
                    `[TRENDING_TOKENS] [${moxieUserId}] No trending tokens found`
                );
                await callback({
                    text: "No trending tokens found.",
                });
                return true;
            }

            elizaLogger.debug(
                traceId,
                `[TRENDING_TOKENS] [${moxieUserId}] Found ${trendingTokens.length} trending tokens`,
                trendingTokens
            );

            const context = composeContext({
                state: {
                    ...state,
                    trendingTokens,
                },
                template,
            });

            const summaryStream = streamText({
                runtime,
                context,
                modelClass: ModelClass.LARGE,
                modelConfigOptions: {
                    temperature: 0.5,
                    maxOutputTokens: 8192,
                    modelProvider: ModelProviderName.ANTHROPIC,
                    apiKey: process.env.ANTHROPIC_API_KEY,
                    modelClass: ModelClass.LARGE,
                },
            });

            for await (const text of summaryStream) {
                callback({ text: text });
            }
        } catch (e) {
            elizaLogger.error(
                traceId,
                `[TRENDING_TOKENS] [${moxieUserId}] Error fetching trending tokens: ${e}`
            );
            await callback({
                text: "Failed to fetch trending tokens.",
            });
        }

        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you check my token balance on Base?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "The balance of your agent wallet is 0.01 ETH",
                    action: "TRENDING_TOKENS",
                },
            },
        ],
    ] as ActionExample[][],
};
