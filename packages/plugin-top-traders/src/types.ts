export enum Timeframe {
    DAY = "DAY",
    WEEK = "WEEK",
    MONTH = "MONTH",
}

export interface TopTrader {
    userId: string;
    roi: number;
    pnl: number;
    winRate: number;
    rank: number;
    totalTrades: number;
    scamRate: number;
}

export interface TopTradersResponse {
    data: {
        TopTraders: {
            traders: TopTrader[];
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
