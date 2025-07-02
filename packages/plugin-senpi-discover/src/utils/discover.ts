import { gql } from "graphql-request";
import { elizaLogger } from "@moxie-protocol/core";
import { Timeframe, TopGroupTarget, TopGroupTargetsResponse } from "../types";

export const getTopGroupTargets = async (
    timeframe: Timeframe
): Promise<TopGroupTarget[] | null> => {
    try {
        const query = gql`
            query TopGroupTargets(
                $orderBy: TopTargetsOrderBy
                $skip: Int
                $limit: Int
                $timeframe: Timeframe!
            ) {
                TopGroupTargets(
                    input: {
                        orderBy: $orderBy
                        skip: $skip
                        take: $limit
                        timeframe: $timeframe
                    }
                ) {
                    targets {
                        groupId
                        groupName
                        groupCreatedBy
                        groupCreatedAt
                        groupUpdatedAt
                        groupStatus
                        roi
                        pnl
                        winRate
                        rank
                        totalTrades
                        groupMembersCount
                        scamRate
                    }
                    pagination {
                        totalCount
                        skip
                        take
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
                },
            }),
        });
        const result: TopGroupTargetsResponse = await response.json();

        elizaLogger.debug(`[DISCOVER] result: ${JSON.stringify(result)}`);
        return result.data?.TopGroupTargets?.targets;
    } catch (error) {
        elizaLogger.error(`[DISCOVER] error: ${error}`);
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
