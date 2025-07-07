import { gql } from "graphql-request";
import { elizaLogger } from "@moxie-protocol/core";
import { Timeframe, TopTrader, TopTradersResponse } from "../types";

export const getTopTraders = async (
    timeframe: Timeframe
): Promise<TopTrader[] | null> => {
    try {
        const query = gql`
            query TopTraders(
                $orderBy: TopTargetsOrderBy
                $skip: Int
                $limit: Int
                $timeframe: Timeframe!
            ) {
                TopTraders(
                    input: {
                        orderBy: $orderBy
                        skip: $skip
                        take: $limit
                        timeframe: $timeframe
                    }
                ) {
                    traders {
                        rank
                        userId
                        pnl
                        roi
                        winRate
                        scamRate
                        totalTrades
                    }
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
                variables: {
                    timeframe,
                    limit: 25,
                    orderBy: {
                        roi: "DESC",
                    },
                },
            }),
        });
        const result: TopTradersResponse = await response.json();

        elizaLogger.debug(`[getTopTraders] result: ${JSON.stringify(result)}`);
        return result.data?.TopTraders?.traders;
    } catch (error) {
        elizaLogger.error(`[getTopTraders] error: ${error}`);
        return null;
    }
};

export const convertTimeframeToDays = (timeframe: Timeframe): number => {
    switch (timeframe) {
        case Timeframe.DAY:
            return 1;
        case Timeframe.WEEK:
            return 7;
        case Timeframe.MONTH:
            return 30;
    }
};

export const formatNumber = (
    number: number,
    maximumFractionDigits: number = 3
): string => {
    return number.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits,
    });
};

export const formatPnl = (
    pnl: number,
    maximumFractionDigits: number = 2
): string => {
    const sign = pnl >= 0 ? "+" : "-";
    const absoluteValue = Math.abs(pnl);
    const formattedValue = absoluteValue.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits,
    });
    return `${sign}$${formattedValue}`;
};
