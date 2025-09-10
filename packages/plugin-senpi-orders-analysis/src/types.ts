import { z } from "zod";
export interface GetUserGroupStatsOrRecommendationsInput {
    analysisType: AnalysisType;
    days: number;
    userOrGroupId?: string;
    orderBy: GetUserGroupStatsOrRecommendationsOrderBy;
    skip?: number;
    take?: number;
}

export enum GetUserGroupStatsOrRecommendationsOrderBy {
    WIN_RATE = "WIN_RATE",
}

/**
 * @description Analysis type
 *
 * @enum {string} USER: Provides user-level stats/recommendations
 * @enum {string} GROUP: Provides group-level stats/recommendations
 */
export enum AnalysisType {
    USER = "USER",
    GROUP = "GROUP",
}

export interface GetUserGroupStatsOrRecommendationsResponse {
    data: {
        GetUserGroupStatsOrRecommendations: {
            items: GetUserGroupStatsOrRecommendationsItem[];
        };
    };
    errors: {
        message: string;
    }[];
}

export interface GetUserGroupStatsOrRecommendationsItem {
    initiatorUserId: string;
    initiatorUserName: string;
    groupId: string;
    groupName: string;
    groupCreatedBy: string; //mid
    groupCreatorName: string;
    tradeCount: number;
    winRate: number;
}

export interface SenpiOrdersAnalysisResponse {
    data: {
        days: number;
        userOrGroupId: string | null;
        analysisType: AnalysisType;
    };
    error: {
        prompt_message: string;
    } | null;
}

export const SenpiOrdersAnalysisResponseSchema = z.object({
    data: z.object({
        analysisType: z.enum(["USER", "GROUP"]),
        days: z.number(),
        userOrGroupId: z.string().nullable(),
    }),
});
