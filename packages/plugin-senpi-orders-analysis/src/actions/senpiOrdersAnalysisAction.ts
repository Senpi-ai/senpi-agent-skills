import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    elizaLogger,
    type ActionExample,
    composeContext,
    ModelClass,
    generateObjectDeprecated,
    ModelProviderName,
    streamText,
} from "@moxie-protocol/core";
import { getSenpiOrdersAnalysis } from "../utils/ordersAnalysis";
import { MoxieUser } from "@moxie-protocol/moxie-agent-lib/src/services/types";
import {
    AnalysisType,
    GetUserGroupStatsOrRecommendationsOrderBy,
} from "../types";
import {
    analysisOrRecommendTemplate,
    senpiOrdersAnalysisTemplate,
} from "../templates";

export const senpiOrdersAnalysisAction: Action = {
    name: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
    similes: [
        "ANALYZE_MY_TRADES",
        "ANALYZE_MY_GROUPS",
        "RECOMMEND_TOP_TRADERS",
        "RECOMMEND_TOP_GROUPS",
    ],
    description:
        "Analyze the senpi orders or recommend the top traders and groups",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        try {
            const traceId = message.id;
            const moxieUserInfo = state.moxieUserInfo as MoxieUser;
            const moxieUserId = moxieUserInfo.id;
            // Analyze user's message w/ AI
            const swapContext = composeContext({
                state,
                template: senpiOrdersAnalysisTemplate,
            });

            // Generate swap content
            const senpiOrdersAnalysisResponse = await generateObjectDeprecated({
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
            });

            if (!senpiOrdersAnalysisResponse.success) {
                elizaLogger.warn(
                    traceId,
                    `[${traceId}] [senpiOrdersAnalysisAction] [${moxieUserId}] [SENPI_ORDERS_ANALYSIS] error occured while performing senpi orders analysis operation: ${JSON.stringify(senpiOrdersAnalysisResponse.error)}`
                );
                callback?.({
                    text: senpiOrdersAnalysisResponse.error.prompt_message,
                    action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                });
                return true;
            }

            elizaLogger.debug(
                traceId,
                `[${traceId}] [senpiOrdersAnalysisAction] [${moxieUserId}] [SENPI_ORDERS_ANALYSIS] senpi orders analysis response: ${JSON.stringify(senpiOrdersAnalysisResponse)}`
            );

            // Deconstruct result from AI for input to getSenpiOrdersAnalysis

            const senpiOrdersAnalysis = await getSenpiOrdersAnalysis(
                {
                    analysisType: AnalysisType.USER,
                    days: 30,
                    orderBy: GetUserGroupStatsOrRecommendationsOrderBy.AVG_PNL,
                },
                state.authorizationHeader as string
            );

            const newContext = composeContext({
                state: {
                    ...state,
                    orders: senpiOrdersAnalysis,
                },
                template: analysisOrRecommendTemplate,
            });

            // Stream Text using anthropic model
            const analysisOrRecommendStream = streamText({
                runtime,
                context: newContext,
                modelClass: ModelClass.LARGE,
                modelConfigOptions: {
                    temperature: 1.0,
                    modelProvider: ModelProviderName.OPENAI,
                    apiKey: process.env.OPENAI_API_KEY!,
                    modelClass: ModelClass.LARGE,
                },
            });

            for await (const textPart of analysisOrRecommendStream) {
                callback({ text: textPart });
            }

            return true;
        } catch (error) {
            elizaLogger.error(
                `[senpiOrdersAnalysisAction] Error fetching senpi orders analysis: ${error}`
            );
            await callback?.({
                text: `Error fetching senpi orders analysis: ${error}`,
            });
            return true;
        }
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
                    action: "TOKEN_BALANCE_ON_BASE",
                },
            },
        ],
    ] as ActionExample[][],
};
