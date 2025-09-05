import { elizaLogger } from "@moxie-protocol/core";
import {
    GetUserGroupStatsOrRecommendationsInput,
    GetUserGroupStatsOrRecommendationsResponse,
} from "../types";

export const getSenpiOrdersAnalysis = async (
    input: GetUserGroupStatsOrRecommendationsInput,
    authorizationHeader: string
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
                            avgPnl
                            groupCreatedBy
                            groupId
                            groupName
                            initiatorUserId
                            initiatorUserName
                            totalPnl
                            tradeCount
                            winRate
                        }
                        pagination {
                            skip
                            take
                            totalCount
                        }
                    }
                }
            `;
            const response = await fetch(process.env.MOXIE_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: authorizationHeader,
                },
                body: JSON.stringify({ query, variables: { input } }),
            });

            if (!response.ok) {
                const errorMessage = `[getSenpiOrdersAnalysis] Error fetching senpi orders analysis status: ${response.status} ${response.statusText}`;
                elizaLogger.error(errorMessage);
                throw new Error(errorMessage);
            }

            const { data, errors } =
                (await response.json()) as GetUserGroupStatsOrRecommendationsResponse;

            if (errors) {
                const errorMessage = errors[0].message;
                elizaLogger.error(
                    `[getSenpiOrdersAnalysis] Error fetching senpi orders analysis: ${errorMessage}`
                );
                throw new Error(
                    `[getSenpiOrdersAnalysis] Error fetching senpi orders analysis: ${errorMessage}`
                );
            }

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
