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
    ModelProviderName,
} from "@moxie-protocol/core";
import {
    getSenpiOrdersAnalysis,
    generateCTAConfig,
} from "../utils/ordersAnalysis";
import { MoxieUser } from "@moxie-protocol/moxie-agent-lib/src/services/types";
import { generateUniqueGroupName } from "@moxie-protocol/plugin-moxie-groups/src/utils";
import {
    GetUserGroupStatsOrRecommendationsOrderBy,
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
        "Use for analyzing user's trades/groups/group members or recommending which top traders/groups by performance metrics (win rate and trade count) to copy trade/add to their groups. Example: “top traders”, “best groups”. ❌ Not for social posts or news.",
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
                modelClass: ModelClass.LARGE,
                schema: SenpiOrdersAnalysisResponseSchema,
            });

            const { data, error } =
                senpiOrdersAnalysisResponse.object as SenpiOrdersAnalysisResponse;

            if (error?.prompt_message) {
                elizaLogger.warn(
                    traceId,
                    `[${traceId}] [senpiOrdersAnalysisAction] [${moxieUserId}] [SENPI_ORDERS_ANALYSIS] error occured while performing senpi orders analysis operation: ${JSON.stringify(error.prompt_message)}`
                );

                if (error.prompt_message.includes("INVALID_USER_GROUP_ID")) {
                    // Currently only happens for scenario 3 when a group is tagged, so only referencing group
                    await callback?.({
                        text: "Looks like the group you mentioned is not valid. Can you try again with a different group?",
                        action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    });
                } else if (error.prompt_message.includes("GROUP_NOT_FOUND")) {
                    await callback?.({
                        text: "Looks like the user you mentioned does not exist. Can you try again with a different user?",
                        action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    });
                } else if (error.prompt_message.includes("USER_NO_ACCESS")) {
                    await callback?.({
                        text: "Looks like the user you're trying to access other user's data. Unfortunately, you're not allowed to do that. Can you try again with asking to analyze your own trades/groups?",
                        action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    });
                } else if (
                    error.prompt_message.includes("GROUP_NO_ACCESS_TO_USER")
                ) {
                    await callback?.({
                        text: "Looks like the group you mentioned does not belong to you. Can you try again with a different group that you own?",
                        action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    });
                } else if (error.prompt_message.includes("INVALID_REQUEST")) {
                    await callback?.({
                        text: "Sorry, there was an error processing your request. Please try again.",
                        action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    });
                } else {
                    await callback?.({
                        text: "Error occured while performing senpi orders analysis operation. Please try again later.",
                        action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    });
                }
                return true;
            }

            elizaLogger.debug(
                traceId,
                `[${traceId}] [senpiOrdersAnalysisAction] [${moxieUserId}] [SENPI_ORDERS_ANALYSIS] senpi orders analysis response: ${JSON.stringify(senpiOrdersAnalysisResponse)}`
            );

            const { userOrGroupId } = data ?? {};
            const senpiOrdersAnalysis = await getSenpiOrdersAnalysis(
                {
                    ...data,
                    orderBy: GetUserGroupStatsOrRecommendationsOrderBy.WIN_RATE,
                    skip: 0,
                    // If stats analysis, get all 100, otherwise recommendation just give top 10
                    take: userOrGroupId ? 100 : 10,
                },
                state.authorizationHeader as string,
                traceId
            );

            if (senpiOrdersAnalysis.length === 0) {
                if (userOrGroupId) {
                    await callback?.({
                        text: "Looks like you have not done any auto trades yet on Senpi. Please try again later after doing some auto trades.",
                        action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    });
                } else {
                    await callback?.({
                        text: `Sorry, looks like there is no recommendations found for the given request. Please try again later. \nIf the issue persists, tap the 👎 button to report this issue, or contact our team in the [Senpi Dojo Telegram Group](${process.env.SENPI_TELEGRAM_GROUP_URL}) for further assistance. 🙏`,
                        action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    });
                }
                return true;
            }

            const newContext = composeContext({
                state: {
                    ...state,
                    orders: JSON.stringify(senpiOrdersAnalysis),
                    userData: JSON.stringify(moxieUserInfo),
                },
                template: analysisOrRecommendTemplate,
            });

            const analysisOrRecommendStream = streamText({
                runtime,
                context: newContext,
                modelClass: ModelClass.LARGE,
                modelConfigOptions: {
                    temperature: 1.0,
                    modelProvider: ModelProviderName.ANTHROPIC,
                    apiKey: process.env.ANTHROPIC_API_KEY!,
                    modelClass: ModelClass.LARGE,
                },
            });

            let groupName;

            if (!userOrGroupId && data?.analysisType === "USER") {
                const groupBaseName = `top_traders_${new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).replace(/,/g, "").replace(/ /g, "_")}`;

                groupName = await generateUniqueGroupName(
                    state.authorizationHeader as string,
                    groupBaseName
                );
            }

            // Generate CTA configuration using the reusable function
            const ctaConfig = generateCTAConfig({
                userOrGroupId,
                analysisType: data?.analysisType,
                groupName:
                    data?.analysisType === "USER"
                        ? groupName
                        : senpiOrdersAnalysis?.[0]?.groupName,
                groupId:
                    data?.analysisType === "USER"
                        ? null
                        : senpiOrdersAnalysis?.[0]?.groupId,
            });

            for await (const textPart of analysisOrRecommendStream) {
                callback({
                    text: textPart,
                    action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                    ...ctaConfig,
                });
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
                    text: "Analyze my trades/auto-trades/ senpi trades from last 3 days",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "The trades/auto-trades/ senpi trades from last 3 days are as follows:\n | Trade | Win Rate | Trade Count |\n |---|---|---| \n | Trade 1 | 0.5 | 100 |",
                    action: "ANALYZE_TRADES_AND_GROUPS_OR_RECOMMEND_TOP_TRADERS_AND_GROUPS",
                },
            },
        ],
    ] as ActionExample[][],
};
