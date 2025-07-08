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
    getTopGroupTargets,
} from "../utils/discover";
import { discoverTemplate } from "../templates";
import { fetchWithRetries, MoxieUser } from "@moxie-protocol/moxie-agent-lib";
import { getUserByMoxieId } from "@moxie-protocol/moxie-agent-lib/src/services/moxieUserService";
import { DiscoverResponse } from "../types";

export const discoverGroupsAction: Action = {
    name: "DISCOVER_GROUPS",
    similes: ["WHAT_GROUPS_TO_COPY_TRADE"],
    description:
        "Discover top groups to copy trade on Senpi. Use this action if user asks along the lines of 'Who should I copy trade?' or 'What groups to copy trade?'",
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
                    `[discover] [${moxieUserId}] [DISCOVER] error occured while performing add rule operation: ${JSON.stringify(discoverResponse.error)}`
                );
                callback?.({
                    text: discoverResponse.error.prompt_message,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            const { params } = discoverResponse ?? {};
            const { timeframe } = params ?? {};
            // Step 2: Fetch the data from the API
            const topGroupTargets = await fetchWithRetries(
                () => getTopGroupTargets(timeframe),
                3,
                1000
            );
            const days = convertTimeframeToDays(timeframe);

            elizaLogger.debug(
                traceId,
                `[DiscoverAction] [${moxieUserId}] [DISCOVER] params: ${JSON.stringify(topGroupTargets)}`
            );

            if (!topGroupTargets || topGroupTargets.length === 0) {
                await callback?.({
                    text: `No top groups to copy trade on Senpi found in the last ${days} day${days > 1 ? "s" : ""}.`,
                    action: "DISCOVER_GROUPS",
                });
                return true;
            }

            // Step 3: Generate the response
            const groupRows = await Promise.all(
                topGroupTargets.map(
                    async ({
                        groupName,
                        groupId,
                        groupCreatedBy,
                        totalTrades,
                        roi,
                        pnl,
                        winRate,
                        scamRate,
                    }) => {
                        const userName =
                            (await getUserByMoxieId(groupCreatedBy))
                                ?.userName ?? groupCreatedBy;
                        return `| #[${groupName} (by ${userName})|${groupId}] | ${formatNumber(totalTrades)} | ${formatNumber(roi)}x | ${formatPnl(pnl)} | ${formatNumber(winRate, 2)}% | ${formatNumber(scamRate, 2)}% |`;
                    }
                )
            );

            await callback?.({
                // Make it table format markdown
                text: `The top groups to copy trade on Senpi are in the last ${days} day${days > 1 ? "s" : ""} are as follows:\n | Group | Trades | ROI | PnL | Win Rate | Scam Rate |\n |---|---|---|---|---|---| \n ${groupRows.join("\n")}\n\nTo copy trade one of the groups here, simply click on the highlighted group name to build your copy trading strategy.\n\nTo discover more groups, go to the [Discover page](https://${process.env.SENPI_URL}/discover/top-groups) on Senpi.`,
                action: "DISCOVER_GROUPS",
            });
        } catch (e) {
            elizaLogger.error(
                traceId,
                `[DiscoverAction] [${moxieUserId}] Error: ${e}`
            );
            await callback?.({
                text: `Something went wrong while discovering groups. Please try again later.`,
                action: "DISCOVER_GROUPS",
            });
        }
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Who should I copy trade?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "The top groups to copy trade on Senpi are in the last 7 days are as follows:\n | Group | Trades | ROI | PNL |\n |---|---|---|---| \n | farcaster | 1248 | 0.082257% | 246230.900595 |",
                    action: "DISCOVER_GROUPS",
                },
            },
        ],
    ] as ActionExample[][],
};
