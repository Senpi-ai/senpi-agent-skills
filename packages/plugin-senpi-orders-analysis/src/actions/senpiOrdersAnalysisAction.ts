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
    generateObject,
    streamText,
} from "@moxie-protocol/core";
import { getSenpiOrdersAnalysis } from "../utils/ordersAnalysis";
import { MoxieUser } from "@moxie-protocol/moxie-agent-lib/src/services/types";
import {
    SenpiOrdersAnalysisResponse,
    SenpiOrdersAnalysisResponseSchema,
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
        "Analyze the trades and groups from a user's senpi orders or recommend the top traders and groups",
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
            const context = composeContext({
                state: {
                    ...state,
                    userData: JSON.stringify(moxieUserInfo),
                },
                template: senpiOrdersAnalysisTemplate,
            });

            const senpiOrdersAnalysisResponse = await generateObject({
                runtime,
                context,
                modelClass: ModelClass.MEDIUM,
                schema: SenpiOrdersAnalysisResponseSchema,
            });

            const { data, error } =
                senpiOrdersAnalysisResponse.object as SenpiOrdersAnalysisResponse;

            if (error?.prompt_message) {
                elizaLogger.warn(
                    traceId,
                    `[${traceId}] [senpiOrdersAnalysisAction] [${moxieUserId}] [SENPI_ORDERS_ANALYSIS] error occured while performing senpi orders analysis operation: ${JSON.stringify(error.prompt_message)}`
                );
                await callback?.({
                    text: "Error occured while performing senpi orders analysis operation. Please try again later.",
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
                    ...data,
                    skip: 0,
                    take: 10,
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
