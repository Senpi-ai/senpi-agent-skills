import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    type ActionExample,
    composeContext,
    generateObjectDeprecated,
    ModelClass,
    elizaLogger,
} from "@moxie-protocol/core";
import {
    convertTimeframeToDays,
    formatNumber,
    formatPnl,
    getTopTraders,
} from "../utils/discover";
import { discoverTemplate } from "../templates";
import { fetchWithRetries, MoxieUser } from "@moxie-protocol/moxie-agent-lib";
import { getUserByMoxieId } from "@moxie-protocol/moxie-agent-lib/src/services/moxieUserService";
import { DiscoverResponse } from "../types";

export const discoverTopTradersAction: Action = {
    name: "TOP_TRADERS",
    similes: ["WHAT_TOP_TRADERS_TO_COPY_TRADE"],
    description:
        "Discover top traders to copy trade on Senpi. Always select this if user ask who the top traders are.",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        const traceId = message.id;
        const moxieUserInfo = state.moxieUserInfo as MoxieUser;
        const moxieUserId = moxieUserInfo.id;
        try {
            // Step 1: Analyze user's message & parse the data
            const context = composeContext({
                state,
                template: discoverTemplate,
            });

            const discoverResponse: DiscoverResponse =
                await generateObjectDeprecated({
                    runtime,
                    context,
                    modelClass: ModelClass.LARGE,
                });

            if (!discoverResponse.success) {
                elizaLogger.warn(
                    traceId,
                    `[${moxieUserId}] [TOP_TRADERS] error occured while fetching top traders: ${JSON.stringify(discoverResponse.error)}`
                );
                callback?.({
                    text: discoverResponse.error.prompt_message,
                    action: "TOP_TRADERS",
                });
                return true;
            }

            const { params } = discoverResponse ?? {};
            const { timeframe } = params ?? {};
            // Step 2: Fetch the data from the API
            const topTraders = await fetchWithRetries(
                () => getTopTraders(timeframe),
                3,
                1000
            );
            const days = convertTimeframeToDays(timeframe);

            elizaLogger.debug(
                traceId,
                `[DiscoverTopTradersAction] [${moxieUserId}] [TOP_TRADERS] params: ${JSON.stringify(topTraders)}`
            );

            if (!topTraders || topTraders.length === 0) {
                await callback?.({
                    text: `No top traders to copy trade on Senpi found in the last ${days} day${days > 1 ? "s" : ""}.`,
                    action: "TOP_TRADERS",
                });
                return true;
            }

            // Step 3: Generate the response
            const groupRows = await Promise.all(
                topTraders.map(
                    async ({
                        userId,
                        totalTrades,
                        roi,
                        pnl,
                        winRate,
                        scamRate,
                    }) => {
                        const userName =
                            (await getUserByMoxieId(userId))?.userName ??
                            userId;
                        return `| @[${userName}|${userId}] | ${formatNumber(totalTrades)} | ${formatNumber(roi * 100)}% | ${formatPnl(pnl)} | ${formatNumber(winRate, 2)}% | ${formatNumber(scamRate, 2)}% |`;
                    }
                )
            );

            await callback?.({
                // Make it table format markdown
                text: `The top traders to copy trade on Senpi are in the last ${days} day${days > 1 ? "s" : ""} are as follows:\n | Trader | Trades | ROI | PnL | Win Rate | Scam Rate |\n |---|---|---|---|---|---| \n ${groupRows.join("\n")}\n\nTo copy trade one of the traders here, simply click on the highlighted trader name to build your copy trading strategy.\n\nTo discover more traders, go to the [Discover page](https://${process.env.SENPI_URL}/discover/top-traders) on Senpi.\n\nIf you want to discover top groups to copy trade, let me know and I can provide you with a list of for that.`,
                action: "TOP_TRADERS",
            });
        } catch (e) {
            elizaLogger.error(
                traceId,
                `[DiscoverTopTradersAction] [${moxieUserId}] Error: ${e}`
            );
            await callback?.({
                text: `Something went wrong while discovering top traders. Please try again later.`,
                action: "TOP_TRADERS",
            });
        }
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Who are the top traders?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "The top traders on Senpi are in the last 7 days are as follows:\n | Trader | Trades | ROI | PNL |\n |---|---|---|---| \n | farcaster | 1248 | 0.082257% | 246230.900595 |",
                    action: "TOP_TRADERS",
                },
            },
        ],
    ] as ActionExample[][],
};
