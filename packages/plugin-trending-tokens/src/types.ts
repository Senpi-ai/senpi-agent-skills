export interface GetTrendingTokensResponse {
    data: {
        GetTrendingTokens: {
            address: `0x${string}`;
            buyVolume24: string;
            change1: string;
            change12: string;
            change24: string;
            change4: string;
            createdAt: number;
            holders: number;
            liquidity: string;
            marketCap: string;
            name: string;
            priceUSD: string;
            sellVolume24: string;
            symbol: string;
            uniqueBuys1: number;
            uniqueBuys12: number;
            uniqueBuys24: number;
            uniqueBuys4: number;
            uniqueSells1: number;
            uniqueSells12: number;
            uniqueSells24: number;
            uniqueSells4: number;
            volume24: string;
            volumeChange1: string;
            volumeChange12: string;
            volumeChange24: string;
            volumeChange4: string;
            volumeChange5m: string;
            walletAgeAvg: string;
        }[];
    };
}
