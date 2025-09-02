import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    elizaLogger,
    type ActionExample,
    composeContext,
    generateObject,
    ModelClass,
} from "@moxie-protocol/core";
import { MoxieWalletClient } from "@moxie-protocol/moxie-agent-lib/src/wallet";
import { formatEther, http, createPublicClient } from "viem";
import { base } from "viem/chains";
import { getSenpiOrdersAnalysis } from "../utils/ordersAnalysis";
import {
    AnalysisType,
    GetUserGroupStatsOrRecommendationsOrderBy,
} from "../types";

export const senpiOrdersAnalysisAction: Action = {
    name: "SENPI_ORDERS_ANALYSIS",
    similes: [],
    description: "Analyze the senpi orders",
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
            // Analyze user's message w/ AI

            // Deconstruct result from AI for input to getSenpiOrdersAnalysis

            const senpiOrdersAnalysis = await getSenpiOrdersAnalysis(
                {
                    analysisType: AnalysisType.USER,
                    days: 30,
                    orderBy: GetUserGroupStatsOrRecommendationsOrderBy.AVG_PNL,
                },
                state.authorizationHeader as string
            );

            // Stream Text using anthropic model
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
