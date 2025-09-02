export interface GetUserGroupStatsOrRecommendationsInput {
    analysisType: AnalysisType;
    days: number;
    userOrGroupId?: string;
    userOrGroupName?: string;
    orderBy: GetUserGroupStatsOrRecommendationsOrderBy;
    skip?: number;
    take?: number;
}

export enum GetUserGroupStatsOrRecommendationsOrderBy {
    AVG_PNL = "AVG_PNL",
    TOTAL_PNL = "TOTAL_PNL",
    WIN_RATE = "WIN_RATE",
    TRADE_COUNT = "TRADE_COUNT",
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
    tradeCount: number;
    totalPnl: number;
    avgPnl: number;
    winRate: number;
}
