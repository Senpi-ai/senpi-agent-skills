import { elizaLogger } from "@moxie-protocol/core";
import {
    GetUserGroupStatsOrRecommendationsInput,
    GetUserGroupStatsOrRecommendationsResponse,
    AnalysisType,
} from "../types";

export interface CTAConfig {
    userOrGroupId?: string | null;
    analysisType?: AnalysisType;
    groupName?: string;
    groupId?: string;
}

export interface CTAResult {
    cta?: string;
    metadata?: {
        callbackPrompt?: string;
        groupId?: string;
        groupName?: string;
    };
}

const API_URL = process.env.MOXIE_API_PROD_URL ?? process.env.MOXIE_API_URL;

export const getSenpiOrdersAnalysis = async (
    input: GetUserGroupStatsOrRecommendationsInput,
    authorizationHeader: string,
    traceId: string
) => {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const query = /* GraphQL */ `
                query ExampleQuery(
                    $input: GetUserGroupStatsOrRecommendationsInput!
                ) {
                    GetUserGroupStatsOrRecommendations(input: $input) {
                        items {
                            groupCreatorName
                            groupCreatedBy
                            groupId
                            groupName
                            initiatorUserId
                            initiatorUserName
                            winRate
                            tradeCount
                        }
                        pagination {
                            skip
                            take
                            totalCount
                        }
                    }
                }
            `;

            elizaLogger.debug(
                `[${traceId}] [getSenpiOrdersAnalysis] query input: ${JSON.stringify(input)}`
            );

            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: authorizationHeader,
                },
                body: JSON.stringify({ query, variables: { input } }),
            });

            if (!response.ok) {
                const errorMessage = `[${traceId}] [getSenpiOrdersAnalysis] Error fetching senpi orders analysis status: ${response.status} ${response.statusText}`;
                elizaLogger.error(errorMessage);
                throw new Error(errorMessage);
            }

            const { data, errors } =
                (await response.json()) as GetUserGroupStatsOrRecommendationsResponse;

            if (errors) {
                const errorMessage = errors[0].message;
                elizaLogger.error(
                    `[${traceId}] [getSenpiOrdersAnalysis] Error fetching senpi orders analysis: ${errorMessage}`
                );
                throw new Error(
                    `[${traceId}] [getSenpiOrdersAnalysis] Error fetching senpi orders analysis: ${errorMessage}`
                );
            }

            elizaLogger.debug(
                `[${traceId}] [getSenpiOrdersAnalysis] senpi orders analysis response: ${JSON.stringify(data)}`
            );

            return data?.GetUserGroupStatsOrRecommendations?.items;
        } catch (error) {
            lastError = error as Error;
            elizaLogger.error(
                `Attempt ${attempt}/${maxRetries} failed for senpi orders analysis: ${error}`
            );

            // If this is not the last attempt, wait before retrying
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
                elizaLogger.info(
                    `[getSenpiOrdersAnalysis] Retrying in ${delay}ms...`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    // If all retries failed, throw the last error
    elizaLogger.error(
        `[getSenpiOrdersAnalysis] All ${maxRetries} attempts failed for senpi orders analysis`
    );
    throw new Error(
        `Error fetching senpi orders analysis after ${maxRetries} attempts: ${lastError?.message}`
    );
};

/**
 * Generates CTA (Call To Action) configuration based on analysis type and user/group context
 * @param config - Configuration object containing userOrGroupId, analysisType, and groupName
 * @returns CTA result object with cta and metadata properties
 */
export const generateCTAConfig = (config: CTAConfig): CTAResult => {
    const { userOrGroupId, analysisType, groupName, groupId } = config;

    // If userOrGroupId exists, no CTA is needed (user is analyzing their own data)
    if (userOrGroupId) {
        return {};
    }

    // For recommendations without specific user/group, determine CTA based on analysis type
    switch (analysisType) {
        case AnalysisType.USER:
            return {
                cta: "CREATE_GROUP_AND_ADD_GROUP_MEMBER",
                metadata: {
                    callbackPrompt: `Create the ${groupName} group and add all of the above users to it.`,
                },
            };
        case AnalysisType.GROUP:
        default:
            return {
                cta: "RULE_TEMPLATE_CARDS",
                metadata: {
                    groupId,
                    groupName,
                },
            };
    }
};
