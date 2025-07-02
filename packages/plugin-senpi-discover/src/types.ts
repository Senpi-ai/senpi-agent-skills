export enum Timeframe {
    DAY = "DAY",
    WEEK = "WEEK",
    MONTH = "MONTH",
}

export interface TopGroupTarget {
    groupId: string;
    groupName: string;
    groupCreatedBy: string;
    groupCreatedAt: string;
    groupUpdatedAt: string;
    groupStatus: string;
    roi: number;
    pnl: number;
    winRate: number;
    rank: number;
    totalTrades: number;
    groupMembersCount: number;
    scamRate: number;
}

export interface TopGroupTargetsResponse {
    data: {
        TopGroupTargets: {
            targets: TopGroupTarget[];
        };
    };
}

export interface DiscoverResponse {
    success: boolean;
    params: {
        timeframe: Timeframe;
    };
    error: {
        prompt_message: string;
    } | null;
}
