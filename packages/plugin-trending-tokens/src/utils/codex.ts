import { elizaLogger } from "@moxie-protocol/core";
import { GetTrendingTokensResponse } from "../types";

export const getTrendingTokens = async () => {
    try {
        const query = /* GraphQL */ `
            query GetTrendingTokens {
                GetTrendingTokens {
                    address
                    buyVolume24
                    change1
                    change12
                    change24
                    change4
                    createdAt
                    holders
                    liquidity
                    marketCap
                    name
                    priceUSD
                    sellVolume24
                    symbol
                    uniqueBuys1
                    uniqueBuys12
                    uniqueBuys24
                    uniqueBuys4
                    uniqueSells1
                    uniqueSells12
                    uniqueSells24
                    uniqueSells4
                    volumeChange1
                    volumeChange12
                    volumeChange24
                    volumeChange4
                    volumeChange5m
                    walletAgeAvg
                }
            }
        `;
        const response = await fetch(process.env.MOXIE_API_URL_INTERNAL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query,
            }),
        });
        const { data } = (await response.json()) as GetTrendingTokensResponse;
        return data?.GetTrendingTokens ?? [];
    } catch (error) {
        elizaLogger.error(
            `Error fetching trending tokens: ${error}`,
            error as Error
        );
        throw error;
    }
};
