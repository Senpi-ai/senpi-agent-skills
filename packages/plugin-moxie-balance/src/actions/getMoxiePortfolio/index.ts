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
import { MoxieUser, moxieUserService, Portfolio, getPortfolioV2Data, PortfolioV2Data, MoxieAgentDBAdapter } from "@moxie-protocol/moxie-agent-lib";
import { getCommonHoldings, getMoxieCache, getMoxieToUSD, getWalletAddresses, setMoxieCache, handleIneligibleMoxieUsers, formatMessages } from "../../util";
import { PortfolioUserRequested } from "../../types";

export interface PortfolioSummary {
    [userName: string]: {
        tokenBalances: any[];
        totalTokenValue: number;
    }
}

/**
 * Generates a summary of the user's portfolio data
 * Filters and sorts token balances and app balances by value
 */
async function generatePortfolioSummary(
    portfolioV2Data: PortfolioV2Data,
    moxieUserInfo: MoxieUser,
    message: Memory,
    runtime: IAgentRuntime,
    isSelfPortolioRequested: boolean,
) {


    const portfolioDataFiltered = {
        tokenBalances: portfolioV2Data?.tokenBalances?.byToken?.edges,
    };


    const tokenAddresses = [...new Set(portfolioV2Data?.metadata?.addresses)]
        .map((address: string) => `${address.slice(0, 2)}*****${address.slice(-4)}`);

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
        tokenAddresses: isSelfPortolioRequested ? JSON.stringify(tokenAddresses) : JSON.stringify([]),
        message: message.content.text
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
    runtime: IAgentRuntime,
    moxieToUSD: number,
){

    const portfolioSummaries: PortfolioSummary[] = [];
    const commonPortfolioHoldingsMetadata = {}
    for (const userInfo of moxieUserInfoMultiple) {
        const walletAddresses = await getWalletAddresses(userInfo);

        if (!walletAddresses.length) {
            continue;
        }

        const portfolioV2Data = await getPortfolioV2Data(walletAddresses, ["BASE_MAINNET"], userInfo.id, runtime)

        if(!portfolioV2Data || portfolioV2Data?.tokenBalances?.totalBalanceUSD === 0) {
            continue;
        }
        const totalTokenValue = portfolioV2Data?.tokenBalances?.totalBalanceUSD || 0;
        let tokenHoldings = []

        portfolioV2Data.tokenBalances.byToken.edges.forEach(token => {
            tokenHoldings.push({tokenSymbol: token.node.symbol, balanceUSD: token.node.balanceUSD, balance: token.node.balance})
        })

        const tokenBalancesFiltered = portfolioV2Data.tokenBalances.byToken.edges
        tokenBalancesFiltered.forEach(token => {
            token.node.holdingPercentage = (token.node.balanceUSD*100) / totalTokenValue
        })



        portfolioSummaries.push({
            [userInfo.userName]: {
                tokenBalances: tokenBalancesFiltered,
                totalTokenValue: totalTokenValue,
            }
        });
        commonPortfolioHoldingsMetadata[userInfo.userName] = {
            tokenHoldings: tokenHoldings
        }
    }

    return {portfolioSummaries, commonPortfolioHoldingsMetadata}
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
        "PORTFOLIO_STATUS"
    ],
    suppressInitialMessage: true,
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("[Portfolio] Validating request");
        return true;
    },
    description: "Retrieves current portfolio summary showing token holdings, USD values, and creator coins. Supports multiple users if requested. Don't use this for Social details.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("[Portfolio] Starting portfolio fetch");



        try {
            const moxieToUSD = await getMoxieToUSD()
            const moxieUserInfoState = state.moxieUserInfo as MoxieUser
            const moxieUserId = (state.moxieUserInfo as MoxieUser)?.id

            let moxieUserInfo: MoxieUser = await moxieUserService.getUserByPrivyBearerToken(state.authorizationHeader as string)
            let moxieUserInfoMultiple: MoxieUser[] = [];
            let isSelfPortolioRequested = false

            let requestedMoxieUserIds = (message.content.text.match(/@\[[\w\.-]+\|M\d+\]/g) || [])
                 .map(match => match.split("|")[1].replace("]", ""));

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

                const requestedMoxieUserIdsResponse = await generateObjectDeprecated({
                    runtime,
                    context: previousQuestionContext,
                    modelClass: ModelClass.LARGE,
                }) as PortfolioUserRequested;

                requestedMoxieUserIds = requestedMoxieUserIdsResponse.requestedUsers;
            }

            elizaLogger.info(`[Portfolio] Requested Moxie user IDs: ${requestedMoxieUserIds}`);

            if (requestedMoxieUserIds?.length === 0) {
                await callback({
                    text: "I couldn't find any users for whom portfolio information is requested. Can you try again by mentioning the users in your message?",
                    action: "PORTFOLIO_ERROR"
                });
                return false;
            }

            if (requestedMoxieUserIds?.length === 1 && requestedMoxieUserIds[0] === moxieUserId) {
                isSelfPortolioRequested = true
            }

            if (requestedMoxieUserIds?.length > 1) {

                if (requestedMoxieUserIds?.length > 3) {
                    await callback({
                        text: "Its not possible to process more than 3 users at a time. Please specify a single user or fewer users. (less than 3)",
                        action: "PORTFOLIO_ERROR"
                    });
                    return false;
                }
                const userInfoResults = await Promise.all(requestedMoxieUserIds.map(moxieUserId => 
                    moxieUserService.getUserByMoxieId(moxieUserId)
                ));
                moxieUserInfoMultiple.push(...userInfoResults);

                const {portfolioSummaries, commonPortfolioHoldingsMetadata} = await handleMultipleUsers(moxieUserInfoMultiple, runtime, moxieToUSD);
                const {filteredCommonTokenHoldings} = getCommonHoldings(moxieUserInfoMultiple, commonPortfolioHoldingsMetadata)
                const newstate = await runtime.composeState(message, {
                    portfolioSummaries: JSON.stringify(portfolioSummaries),
                    isSelfPortolioRequested: JSON.stringify(false),
                    message: message.content.text,
                    filteredCommonTokenHoldings: JSON.stringify(filteredCommonTokenHoldings),
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
                    callback({ text: textPart,action: "PORTFOLIO_MULTIPLE_SUCCESS" });
                }

                return true;

            }

            elizaLogger.info("[Portfolio-TokenGate] isSelfPortolioRequested", isSelfPortolioRequested, "requestedMoxieUserIds", requestedMoxieUserIds);

            if (!isSelfPortolioRequested && requestedMoxieUserIds?.length === 1) {
                try {
                    const userInfo = await moxieUserService.getUserByMoxieId(requestedMoxieUserIds[0])
                    elizaLogger.info("[Portfolio] userInfo for requestedMoxieUser", userInfo);
                    moxieUserInfo = userInfo
                } catch (error) {
                    elizaLogger.error("[Portfolio] Error fetching user info for requestedMoxieUser", error, error?.stack);
                    await callback({
                        text: "There was an error processing your request. Please try again later.",
                        action: "PORTFOLIO_ERROR",
                    });
                    return false;
                }
            }

            
            // Get wallet addresses for single user
            const walletAddresses = await getWalletAddresses(moxieUserInfo);

            elizaLogger.log(`[Portfolio] Processing wallet address: ${walletAddresses}`);

            if (!walletAddresses) {
                await callback({
                    text: "No wallet address linked to your account",
                    action: "PORTFOLIO_ERROR"
                });
                return false;
            }

            elizaLogger.log("[Portfolio] Fetching portfolio data");

            // Fetch fresh portfolio data
            const portfolioV2Data = await getPortfolioV2Data(walletAddresses, ["BASE_MAINNET"], moxieUserInfo?.id, runtime)
            const totalTokenValue = portfolioV2Data?.tokenBalances?.totalBalanceUSD || 0;
            portfolioV2Data?.tokenBalances?.byToken?.edges?.forEach(token => {
                token.node.holdingPercentage = (token?.node?.balanceUSD*100) / totalTokenValue
            })

            if(!portfolioV2Data || portfolioV2Data?.tokenBalances?.totalBalanceUSD === 0) {
                elizaLogger.error("[Portfolio] No Tokens in the portfolio for this wallet address: ", walletAddresses, ' moxieUser :', JSON.stringify(moxieUserInfo));
                await callback({
                    text: "I couldn't find any Tokens in the portfolio for this wallet address",
                    action: "PORTFOLIO_ERROR"
                });
                return false;
            }

            elizaLogger.success("[Portfolio] Portfolio data fetched successfully");
            elizaLogger.log("[Portfolio] Generating portfolio summary");

            const summaryStream = await generatePortfolioSummary(portfolioV2Data, moxieUserInfo, message, runtime, isSelfPortolioRequested);

            elizaLogger.success("[Portfolio] Successfully generated portfolio summary");

            for await (const textPart of summaryStream) {
                callback({ text: textPart,action: "PORTFOLIO_SUCCESS" });
            }

            return true;

        } catch (error) {
            elizaLogger.error("[Portfolio] Error fetching portfolio:", error, error?.stack);
            if (callback) {
                await callback({
                    text: ` There is some problem while fetching the portfolio. Please try again later.`,
                    content: { error: error.message },
                    action: "PORTFOLIO_ERROR"
                });
            }
            return false;
        }
    },
    examples: portfolioExamples,
    template: portfolioSummary,
} as Action;
