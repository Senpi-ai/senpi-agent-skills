// Import required dependencies and types
import {
    composeContext,
    elizaLogger,
    streamText,
    HandlerCallback,
    generateMessageResponse,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    type Action,
    stringToUuid,
    generateObjectDeprecated,
} from "@moxie-protocol/core";
import { portfolioExamples } from "./examples";
import { mutiplePortfolioSummary, portfolioSummary } from "./template";
import { portfolioUserIdsExtractionTemplate } from "../../commonTemplate";
import {
    MoxieUser,
    moxieUserService,
    Portfolio,
    getPortfolio,
} from "@moxie-protocol/moxie-agent-lib";
import {
    getCommonHoldings,
    getMoxieCache,
    getMoxieToUSD,
    getWalletAddresses,
    setMoxieCache,
    handleIneligibleMoxieUsers,
    formatMessages,
} from "../../util";
import { PortfolioUserRequested } from "../../types";

export interface PortfolioSummary {
    [userName: string]: {
        tokenBalances: any[];
        totalTokenValue: number;
    };
}

/**
 * Generates a summary of the user's portfolio data
 * Filters and sorts token balances and app balances by value
 */
async function generatePortfolioSummary(
    portfolioData: Portfolio,
    moxieUserInfo: MoxieUser,
    message: Memory,
    runtime: IAgentRuntime,
    isSelfPortolioRequested: boolean
) {
    const portfolioDataFiltered = {
        tokenBalances: portfolioData?.tokenBalances,
    };

    const tokenAddresses = [
        ...new Set(portfolioData?.tokenBalances?.map((token) => token.address)),
    ].map(
        (address: string) => `${address.slice(0, 2)}*****${address.slice(-4)}`
    );

    // Compose new state with filtered portfolio data
    const newstate = await runtime.composeState(message, {
        portfolio: JSON.stringify(portfolioDataFiltered),
        moxieUserInfo: JSON.stringify(moxieUserInfo),
        truncatedMoxieUserInfo: JSON.stringify({
            id: moxieUserInfo.id,
            userName: moxieUserInfo.userName,
            name: moxieUserInfo.name,
            bio: moxieUserInfo.bio,
        }),
        tokenAddresses: isSelfPortolioRequested
            ? JSON.stringify(tokenAddresses)
            : JSON.stringify([]),
        message: message.content.text,
    });

    const context = composeContext({
        state: newstate,
        template: portfolioSummary,
    });

    // Generate text summary using AI model
    return streamText({
        runtime,
        context,
        modelClass: ModelClass.MEDIUM,
    });
}
/**
 * Handles portfolio data fetching and processing for multiple users
 */
export async function handleMultipleUsers(
    moxieUserInfoMultiple: MoxieUser[],
    traceId: string
) {
    const portfolioSummaries: PortfolioSummary[] = [];
    const commonPortfolioHoldingsMetadata = {};
    try {
        elizaLogger.info(
            `[${traceId}] [Portfolio] [handleMultipleUsers] Fetching portfolio for multiple users`,
            moxieUserInfoMultiple
        );
        for (const userInfo of moxieUserInfoMultiple) {
            const walletAddresses = await getWalletAddresses(userInfo);

            if (!walletAddresses.length) {
                continue;
            }

            const portfolioData = await getPortfolio(traceId, walletAddresses, [
                8453,
            ]);

            if (!portfolioData || portfolioData?.tokenBalances.length === 0) {
                continue;
            }
            const totalTokenValue = portfolioData?.totalBalanceUSD || 0;
            let tokenHoldings = [];

            portfolioData.tokenBalances.forEach((token) => {
                const { baseToken, balance, balanceUSD } = token.token;
                const { symbol: tokenSymbol } = baseToken;
                tokenHoldings.push({
                    tokenSymbol,
                    balanceUSD,
                    balance,
                });
            });

            const tokenBalancesFiltered = portfolioData.tokenBalances.reduce(
                (acc, token) => {
                    const { baseToken, balanceUSD } = token.token;
                    const tokenAddress = baseToken.address;

                    if (!acc[tokenAddress]) {
                        acc[tokenAddress] = {
                            ...token,
                            holdingPercentage:
                                (balanceUSD * 100) / totalTokenValue,
                        };
                    } else {
                        acc[tokenAddress].token.balanceUSD += balanceUSD;
                        acc[tokenAddress].holdingPercentage =
                            (acc[tokenAddress].token.balanceUSD * 100) /
                            totalTokenValue;
                    }
                    return acc;
                },
                {}
            );

            const tokenBalancesArray = Object.values(tokenBalancesFiltered);

            portfolioSummaries.push({
                [userInfo.userName]: {
                    tokenBalances: tokenBalancesArray,
                    totalTokenValue: totalTokenValue,
                },
            });
            commonPortfolioHoldingsMetadata[userInfo.userName] = {
                tokenHoldings: tokenHoldings,
            };
        }

        return { portfolioSummaries, commonPortfolioHoldingsMetadata };
    } catch (error) {
        elizaLogger.error(
            `[${traceId}] [Portfolio] [handleMultipleUsers] Error fetching portfolio:`,
            error,
            error?.stack
        );
        throw error;
    }
}

// Export the action configuration
export default {
    name: "PORTFOLIO",
    similes: [
        "PORTFOLIO",
        "PORTFOLIO_SUMMARY",
        "TOTAL_BALANCE",
        "ALL_POSITIONS",
        "ASSET_OVERVIEW",
        "HOLDINGS_SUMMARY",
        "WALLET_BALANCE",
        "INVESTMENT_SUMMARY",
        "ASSET_POSITIONS",
        "PORTFOLIO_OVERVIEW",
        "PORTFOLIO_STATUS",
    ],
    suppressInitialMessage: true,
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("[Portfolio] Validating request");
        return true;
    },
    description:
        "Retrieves current portfolio summary showing token holdings, USD values, and creator coins. Supports multiple users if requested. Don't use this for Social details.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("[Portfolio] Starting portfolio fetch");
        const traceId = message.id;

        try {
            const moxieToUSD = await getMoxieToUSD();
            const moxieUserInfoState = state.moxieUserInfo as MoxieUser;
            const moxieUserId = (state.moxieUserInfo as MoxieUser)?.id;

            let moxieUserInfo: MoxieUser =
                await moxieUserService.getUserByPrivyBearerToken(
                    state.authorizationHeader as string
                );
            let moxieUserInfoMultiple: MoxieUser[] = [];
            let isSelfPortolioRequested = false;

            let requestedMoxieUserIds = (
                message.content.text.match(/@\[[\w\.-]+\|M\d+\]/g) || []
            ).map((match) => match.split("|")[1].replace("]", ""));

            if (requestedMoxieUserIds.length === 0) {
                const previousQuestion = formatMessages({
                    agentId: runtime.agentId,
                    actors: state.actorsData ?? [],
                    messages: state?.recentMessagesData,
                });

                // Initialize or update state
                state = (await runtime.composeState(message, {
                    previousQuestion: previousQuestion,
                    latestMessage: message.content.text,
                    userMoxieId: moxieUserId,
                })) as State;

                const previousQuestionContext = composeContext({
                    state,
                    template: portfolioUserIdsExtractionTemplate,
                });

                const requestedMoxieUserIdsResponse =
                    (await generateObjectDeprecated({
                        runtime,
                        context: previousQuestionContext,
                        modelClass: ModelClass.LARGE,
                    })) as PortfolioUserRequested;

                requestedMoxieUserIds =
                    requestedMoxieUserIdsResponse.requestedUsers;
            }

            elizaLogger.info(
                `[Portfolio] Requested Moxie user IDs: ${requestedMoxieUserIds}`
            );

            if (requestedMoxieUserIds?.length === 0) {
                await callback({
                    text: "I couldn't find any users for whom portfolio information is requested. Can you try again by mentioning the users in your message?",
                    action: "PORTFOLIO_ERROR",
                });
                return false;
            }

            if (
                requestedMoxieUserIds?.length === 1 &&
                requestedMoxieUserIds[0] === moxieUserId
            ) {
                isSelfPortolioRequested = true;
            }

            if (requestedMoxieUserIds?.length > 1) {
                if (requestedMoxieUserIds?.length > 3) {
                    await callback({
                        text: "Its not possible to process more than 3 users at a time. Please specify a single user or fewer users. (less than 3)",
                        action: "PORTFOLIO_ERROR",
                    });
                    return false;
                }
                const userInfoResults = await Promise.all(
                    requestedMoxieUserIds.map((moxieUserId) =>
                        moxieUserService.getUserByMoxieId(moxieUserId)
                    )
                );
                moxieUserInfoMultiple.push(...userInfoResults);

                const { portfolioSummaries, commonPortfolioHoldingsMetadata } =
                    await handleMultipleUsers(moxieUserInfoMultiple, traceId);
                const { filteredCommonTokenHoldings } = getCommonHoldings(
                    moxieUserInfoMultiple,
                    commonPortfolioHoldingsMetadata
                );
                const newstate = await runtime.composeState(message, {
                    portfolioSummaries: JSON.stringify(portfolioSummaries),
                    isSelfPortolioRequested: JSON.stringify(false),
                    message: message.content.text,
                    filteredCommonTokenHoldings: JSON.stringify(
                        filteredCommonTokenHoldings
                    ),
                });

                const context = composeContext({
                    state: newstate,
                    template: mutiplePortfolioSummary,
                });

                const summaryStream = streamText({
                    runtime,
                    context,
                    modelClass: ModelClass.MEDIUM,
                });

                for await (const textPart of summaryStream) {
                    callback({
                        text: textPart,
                        action: "PORTFOLIO_MULTIPLE_SUCCESS",
                    });
                }

                return true;
            }

            elizaLogger.info(
                "[Portfolio-TokenGate] isSelfPortolioRequested",
                isSelfPortolioRequested,
                "requestedMoxieUserIds",
                requestedMoxieUserIds
            );

            if (
                !isSelfPortolioRequested &&
                requestedMoxieUserIds?.length === 1
            ) {
                try {
                    const userInfo = await moxieUserService.getUserByMoxieId(
                        requestedMoxieUserIds[0]
                    );
                    elizaLogger.info(
                        "[Portfolio] userInfo for requestedMoxieUser",
                        userInfo
                    );
                    moxieUserInfo = userInfo;
                } catch (error) {
                    elizaLogger.error(
                        "[Portfolio] Error fetching user info for requestedMoxieUser",
                        error,
                        error?.stack
                    );
                    await callback({
                        text: "There was an error processing your request. Please try again later.",
                        action: "PORTFOLIO_ERROR",
                    });
                    return false;
                }
            }

            // Get wallet addresses for single user
            const walletAddresses = await getWalletAddresses(moxieUserInfo);

            elizaLogger.log(
                `[Portfolio] Processing wallet address: ${walletAddresses}`
            );

            if (!walletAddresses) {
                await callback({
                    text: "No wallet address linked to your account",
                    action: "PORTFOLIO_ERROR",
                });
                return false;
            }

            elizaLogger.log("[Portfolio] Fetching portfolio data");

            // Fetch fresh portfolio data
            const portfolioData = await getPortfolio(traceId, walletAddresses, [
                8453,
            ]);

            if (!portfolioData || portfolioData?.totalBalanceUSD === 0) {
                elizaLogger.error(
                    "[Portfolio] No Tokens in the portfolio for this wallet address: ",
                    walletAddresses,
                    " moxieUser :",
                    JSON.stringify(moxieUserInfo)
                );
                await callback({
                    text: "I couldn't find any Tokens in the portfolio for this wallet address",
                    action: "PORTFOLIO_ERROR",
                });
                return false;
            }

            const totalTokenValue = portfolioData?.totalBalanceUSD || 0;
            const groupedTokens = portfolioData?.tokenBalances?.reduce(
                (acc, token) => {
                    const address = token.address;
                    const { balanceUSD } = token.token;

                    if (!acc[address]) {
                        acc[address] = {
                            ...token,
                            token: {
                                ...token.token,
                                balanceUSD: balanceUSD,
                            },
                            holdingPercentage:
                                (balanceUSD * 100) / totalTokenValue,
                        };
                    } else {
                        acc[address].token.balanceUSD += balanceUSD;
                        acc[address].holdingPercentage =
                            (acc[address].token.balanceUSD * 100) /
                            totalTokenValue;
                    }

                    return acc;
                },
                {}
            );

            const groupedTokensArray = Object.values(
                groupedTokens
            ) as TokenBalance[];

            elizaLogger.success(
                "[Portfolio] Portfolio data fetched successfully"
            );
            elizaLogger.log("[Portfolio] Generating portfolio summary");

            const summaryStream = await generatePortfolioSummary(
                {
                    totalBalanceUSD: totalTokenValue,
                    tokenBalances: groupedTokensArray,
                },
                moxieUserInfo,
                message,
                runtime,
                isSelfPortolioRequested
            );
            elizaLogger.success(
                "[Portfolio] Successfully generated portfolio summary"
            );

            for await (const textPart of summaryStream) {
                callback({ text: textPart, action: "PORTFOLIO_SUCCESS" });
            }

            return true;
        } catch (error) {
            elizaLogger.error(
                "[Portfolio] Error fetching portfolio:",
                error,
                error?.stack
            );
            if (callback) {
                await callback({
                    text: ` There is some problem while fetching the portfolio. Please try again later.`,
                    content: { error: error.message },
                    action: "PORTFOLIO_ERROR",
                });
            }
            return false;
        }
    },
    examples: portfolioExamples,
    template: portfolioSummary,
} as Action;
