import {
    IAgentRuntime,
    Memory,
    State,
    HandlerCallback,
    elizaLogger,
    ModelClass,
    composeContext,
    generateObjectDeprecated,
    streamText,
    ModelProviderName,
} from "@moxie-protocol/core";
import { extractWalletTemplate, pnlTemplate } from "../template";
import {
    fetchPnlData,
    fetchTotalPnl,
    preparePnlQuery,
    prepareGroupPnlQuery,
} from "../service/pnlService";
import { MoxieUser, moxieUserService } from "@moxie-protocol/moxie-agent-lib";
import { ethers } from "ethers";
import * as agentLib from "@moxie-protocol/moxie-agent-lib";
import { getGroupDetails } from "@moxie-protocol/plugin-moxie-groups/src/utils";

export const PnLAction = {
    name: "PROFIT_LOSS",
    description:
        "Calculates and summarizes Profit & Loss (PnL) for a specific wallet, token, or Senpi agent. Use this when the user asks about performance, gains/losses, or returns from trading activity.",
    suppressInitialMessage: true,
    examples: [],
    similes: [
        "PNL",
        "PNL_DATA",
        "PROFIT_LOSS",
        "PROFIT_LOSS_DATA",
        "USER_PnL",
        "WALLET_PnL",
        "TOKEN_PnL",
    ],
    validate: async function (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State
    ): Promise<boolean> {
        return true;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback?: HandlerCallback
    ) => {
        const traceId = message.id;
        const moxieUserInfo = state.moxieUserInfo as MoxieUser;
        const moxieUserId = moxieUserInfo.id;
        const agentWallet = state.agentWallet as agentLib.MoxieClientWallet;
        const agentWalletAddress = agentWallet.address.toLowerCase();
        try {
            elizaLogger.debug(
                traceId,
                `[PnLAction] [${moxieUserId}] Starting PnL calculation`
            );

            const latestMessage = message.content.text;
            let start = new Date();
            const context = composeContext({
                state: {
                    ...state,
                    latestMessage: latestMessage,
                    moxieUserId,
                    agentWalletAddress: agentWalletAddress,
                },
                template: extractWalletTemplate,
            });

            const pnlResponse = await generateObjectDeprecated({
                runtime,
                context: context,
                modelClass: ModelClass.MEDIUM,
                modelConfigOptions: {
                    modelProvider: ModelProviderName.OPENAI,
                    temperature: 0.0,
                    apiKey: process.env.OPENAI_API_KEY!,
                    modelClass: ModelClass.MEDIUM,
                },
            });
            elizaLogger.debug(
                traceId,
                `[PnLAction] time taken to extract wallet addresses: ${new Date().getTime() - start.getTime()}ms`
            );
            elizaLogger.debug(
                traceId,
                `[PnLAction] pnlResponse: ${JSON.stringify(pnlResponse)}`
            );
            if (!pnlResponse?.timeFrame) {
                pnlResponse.timeFrame = "lifetime";
                elizaLogger.debug(
                    traceId,
                    `[PnLAction] timeFrame is undefined, setting to lifetime`
                );
            } else if (
                !["1d", "7d", "30d", "lifetime"].includes(pnlResponse.timeFrame)
            ) {
                elizaLogger.error(
                    traceId,
                    `[PnLAction] Unsupported or undefined timeframe provided: ${pnlResponse.timeFrame}`
                );
                await callback?.({
                    text: `The provided timeframe '${pnlResponse.timeFrame}' is not supported or is undefined. Please use one of the following: 1d, 7d, 30d, lifetime, or leave it unspecified for lifetime pnl.`,
                });
                return true;
            }

            const criteria = Array.isArray(pnlResponse.criteria)
                ? pnlResponse.criteria
                : [];

            const tokenAddresses: string[] = [];
            const walletAddresses: string[] = [];
            const moxieUserIds: string[] = [];
            const groupMembers: { groupId: string; memberIds: string[] }[] = [];

            for (const criterion of criteria) {
                if (criterion.TYPE === "tokenAddress") {
                    tokenAddresses.push(criterion.VALUE);
                } else if (criterion.TYPE === "wallet") {
                    walletAddresses.push(criterion.VALUE);
                } else if (criterion.TYPE === "ens") {
                    const resolvedAddress = await resolveENSAddress(
                        context,
                        criterion.VALUE
                    );
                    if (resolvedAddress.isENS) {
                        walletAddresses.push(resolvedAddress.resolvedAddress);
                    } else {
                        walletAddresses.push(criterion.VALUE);
                    }
                } else if (criterion.TYPE === "moxieUserId") {
                    moxieUserIds.push(criterion.VALUE);
                } else if (criterion.TYPE === "group") {
                    try {
                        // Extract group ID from the format {group_id|group_name}
                        const groupId = criterion.VALUE;
                        if (
                            !groupId ||
                            !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
                                groupId
                            )
                        ) {
                            elizaLogger.error(
                                traceId,
                                `[PnLAction] Invalid UUID format: ${criterion.VALUE}`
                            );
                            await callback?.({
                                text: `Invalid Group Id format. Please provide a valid Group Id. Example: #[Group Name|UUID]`,
                            });
                            return true;
                        }

                        // Get group details to fetch members
                        const groupDetails = await getGroupDetails(
                            state.authorizationHeader as string,
                            groupId
                        );
                        if (
                            !groupDetails.groups ||
                            groupDetails.groups.length === 0
                        ) {
                            elizaLogger.error(
                                traceId,
                                `[PnLAction] Group not found: ${groupId}`
                            );
                            await callback?.({
                                text: `Group not found. Please check the group ID.`,
                            });
                            return true;
                        }

                        // Store group members separately
                        const groupMemberIds =
                            groupDetails.groups[0].members.map(
                                (member) => member.moxieUserId
                            );
                        groupMembers.push({
                            groupId,
                            memberIds: groupMemberIds,
                        });
                        elizaLogger.debug(
                            traceId,
                            `[PnLAction] Group members: ${JSON.stringify(groupMemberIds)}`
                        );
                        if (groupMemberIds.length === 0) {
                            elizaLogger.error(
                                traceId,
                                `[PnLAction] No members found in group: ${groupId}`
                            );
                            await callback?.({
                                text: `No members found in the specified group. Please check the group ID.`,
                            });
                            return true;
                        }
                    } catch (error) {
                        elizaLogger.error(
                            traceId,
                            `[PnLAction] Error fetching group details: ${error.message}`
                        );
                        await callback?.({
                            text: `Error fetching group details. Please try again later.`,
                        });
                        return true;
                    }
                }
            }

            if (
                tokenAddresses.length === 0 &&
                walletAddresses.length === 0 &&
                moxieUserIds.length === 0 &&
                groupMembers.length === 0
            ) {
                elizaLogger.error(
                    traceId,
                    `[PnLAction] No valid criteria provided. Please provide at least one token address, wallet address, Senpi user ID, or group.`
                );
                await callback?.({
                    text: `Please provide at least one token address, wallet address, Senpi user ID, or group.`,
                });
                return true;
            }

            pnlResponse.tokenAddresses = tokenAddresses;
            pnlResponse.walletAddresses = walletAddresses;
            pnlResponse.moxieUserIds = moxieUserIds;
            pnlResponse.groupMembers = groupMembers;

            elizaLogger.debug(
                traceId,
                `[PnLAction] categorized token addresses: ${JSON.stringify(tokenAddresses)}`
            );
            elizaLogger.debug(
                traceId,
                `[PnLAction] categorized wallet addresses: ${JSON.stringify(walletAddresses)}`
            );
            elizaLogger.debug(
                traceId,
                `[PnLAction] agent wallet address: ${agentWalletAddress}`
            );
            elizaLogger.debug(
                traceId,
                `[PnLAction] group members: ${JSON.stringify(groupMembers)}`
            );

            let pnlStart = new Date();
            const pnlQuery = preparePnlQuery(pnlResponse);

            // For groups, we need to fetch PnL for each member individually
            let pnlData = [];
            let totalPnl = 0;

            if (groupMembers.length > 0) {
                // Make a single query for all group members using the dedicated group query method
                const groupPnlQuery = prepareGroupPnlQuery(traceId, {
                    ...pnlResponse,
                    groupMembers: groupMembers,
                });
                pnlData = await fetchPnlData(groupPnlQuery);
                // Calculate total PnL for all group members
                totalPnl = pnlData.reduce(
                    (sum, data) => sum + (data.pnl_usd || 0),
                    0
                );
            } else {
                // Handle non-group PnL queries as before
                [pnlData, totalPnl] = await Promise.all([
                    fetchPnlData(pnlQuery),
                    moxieUserIds.length > 0 || walletAddresses.length > 0
                        ? fetchTotalPnl(pnlResponse)
                        : Promise.resolve(0),
                ]);
            }

            elizaLogger.debug(
                traceId,
                `[PnLAction] pnlData: ${JSON.stringify(pnlData)}`
            );
            elizaLogger.debug(traceId, `[PnLAction] totalPnl: ${totalPnl}`);
            if (
                tokenAddresses.length > 0 ||
                moxieUserIds.length > 0 ||
                groupMembers.length > 0
            ) {
                try {
                    const uniqueMoxieUserIds = [
                        ...new Set(
                            pnlData
                                .map((data) => data.username)
                                .filter(
                                    (username) =>
                                        username && username.startsWith("M")
                                )
                        ),
                    ];
                    const userNames =
                        await moxieUserService.getUserByMoxieIdMultiple(
                            uniqueMoxieUserIds
                        );
                    elizaLogger.debug(
                        traceId,
                        `[PnLAction] Fetched user names: ${JSON.stringify(userNames)}`
                    );

                    // Replace moxieUserIds in pnlData with formatted userNames
                    pnlData.forEach((data) => {
                        if (!data.username) return;

                        const userName = userNames.get(data.username)?.userName;
                        const isMoxieId = /^M/.test(data.username);
                        const isWalletAddress = /^0x[a-fA-F0-9]{40}$/.test(
                            data.username
                        );

                        if (isMoxieId) {
                            data.username = `@[${userName || data.username}|${data.username}]`;
                        } else if (isWalletAddress) {
                            const formattedId = `${data.username.slice(0, 6)}...${data.username.slice(-4)}`;
                            data.username = `@[${formattedId}|${data.username}]`;
                        } else if (data.moxie_user_id?.startsWith("M")) {
                            data.username = `@[${data.username}|${data.moxie_user_id}]`;
                        } else {
                            data.username = `@[${data.username}|${data.wallet_address}]`;
                        }
                    });
                } catch (error) {
                    elizaLogger.error(
                        traceId,
                        `[PnLAction] Error fetching user names for Moxie IDs: ${error.message}`
                    );
                }
            }
            // Remove the wallet_address field from each entry in pnlData
            pnlData.forEach((data) => {
                delete data.wallet_address;
            });
            pnlData.forEach((data) => {
                const usernameMatch = data.username.match(/@\[(.*?)\|/);
                if (usernameMatch) {
                    const username = usernameMatch[1];
                    if (username.length > 20) {
                        const shortenedUsername = `${username.slice(0, 6)}...${username.slice(-10)}`;
                        data.username = `@[${shortenedUsername}|${data.moxie_user_id || username}]`;
                    }
                }
            });
            let pnlDataTemplate = pnlTemplate
                .replace("{{latestMessage}}", latestMessage)
                .replace(
                    "{{conversation}}",
                    JSON.stringify(message.content.text)
                )
                .replace("{{criteria}}", JSON.stringify(pnlResponse.criteria))
                .replace("{{pnlData}}", JSON.stringify(pnlData))
                .replace(
                    "{{totalPnl}}",
                    (moxieUserIds.length > 0 ||
                        walletAddresses.length > 0 ||
                        groupMembers.length > 0) &&
                        totalPnl !== null
                        ? totalPnl.toString()
                        : "0"
                );

            const currentContext = composeContext({
                state,
                template: pnlDataTemplate,
            });

            const response = streamText({
                runtime,
                context: currentContext,
                modelClass: ModelClass.MEDIUM,
                modelConfigOptions: {
                    modelProvider: ModelProviderName.OPENAI,
                    temperature: 0.0,
                    apiKey: process.env.OPENAI_API_KEY!,
                    modelClass: ModelClass.MEDIUM,
                },
            });
            elizaLogger.debug(
                traceId,
                `[PnLAction] time taken to generate pnl data template: ${new Date().getTime() - pnlStart.getTime()}ms`
            );
            for await (const textPart of response) {
                callback({ text: textPart, action: "PROFIT_LOSS" });
            }

            return true;
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[PnLAction] Error fetching PnL data: ${error}`
            );
            await callback?.({
                text: `Error fetching PnL data, please try again later`,
            });
            return true;
        }
    },
};

/**
 * Checks if an address is an ENS name and resolves it, with caching to avoid repeated RPC calls.
 * The cache is cleared after a couple of hours to manage memory usage.
 * @param address - The address or ENS name to check and resolve
 * @returns The resolved address and ENS details if applicable
 */

const ensCache = new Map<
    string,
    { isENS: boolean; resolvedAddress: string | null; timestamp: number }
>();
const CACHE_EXPIRY_TIME = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

async function resolveENSAddress(context: any, ensName: string) {
    let start = new Date();
    elizaLogger.debug(
        context,
        `[PnLAction] [resolveENSAddress] Checking address: ${ensName}`
    );

    const currentTime = Date.now();

    // Check cache first and clear expired entries
    if (ensCache.has(ensName)) {
        const cachedEntry = ensCache.get(ensName);
        if (currentTime - cachedEntry.timestamp < CACHE_EXPIRY_TIME) {
            elizaLogger.debug(
                context,
                `[PnLAction] [resolveENSAddress] Cache hit for address: ${ensName}`
            );
            elizaLogger.debug(
                context,
                `[PnLAction] [resolveENSAddress] Time taken to resolve ENS address: ${new Date().getTime() - start.getTime()}ms`
            );
            return {
                isENS: cachedEntry.isENS,
                resolvedAddress: cachedEntry.resolvedAddress,
            };
        } else {
            ensCache.delete(ensName);
        }
    }

    let response = {
        isENS: false,
        resolvedAddress: null,
    };

    try {
        // Check if the address ends with .eth
        const isENS = ensName.toLowerCase().endsWith(".eth");

        if (!isENS) {
            return response;
        }

        const provider = new ethers.JsonRpcProvider(
            process.env.ETH_MAINNET_RPC_URL
        );

        // Try to resolve ENS name with retries and backoff
        let retries = 5;
        let delay = 1000; // Start with 1 second delay

        while (retries > 0) {
            try {
                const resolvedAddress = await provider.resolveName(ensName);

                if (resolvedAddress) {
                    response.isENS = true;
                    response.resolvedAddress = resolvedAddress;
                    // Cache the result with a timestamp
                    ensCache.set(ensName, {
                        ...response,
                        timestamp: currentTime,
                    });
                    elizaLogger.debug(
                        context,
                        `[PnLAction] [resolveENSAddress] Time taken to resolve ENS address: ${new Date().getTime() - start.getTime()}ms`
                    );
                    return response;
                }

                // If no address resolved, try again after delay
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2; // Double the delay for next retry
                retries--;
            } catch (error) {
                elizaLogger.error(
                    context.traceId,
                    `[PnLAction] [resolveENSAddress] Attempt ${6 - retries}/ 5 failed to resolve ENS name: ${ensName}`
                );
                if (retries === 1) {
                    return response;
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
                retries--;
            }
        }

        elizaLogger.error(
            context.traceId,
            `[PnLAction] [resolveENSAddress] Unable to resolve ENS name after retries: ${ensName}`
        );
        return response;
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[PnLAction] [resolveENSAddress] Error resolving ENS: ${error}`
        );
        return response;
    }
}
