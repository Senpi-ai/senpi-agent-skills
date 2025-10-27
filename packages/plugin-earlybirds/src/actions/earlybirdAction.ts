import { Action, IAgentRuntime, Memory, State, HandlerCallback, ActionExample, elizaLogger, composeContext, generateObjectDeprecated, ModelClass } from "@moxie-protocol/core";
import { MoxieUser } from "@moxie-protocol/moxie-agent-lib/src/services/types";
import { earlyBirdsTemplate, earlybirdWalletAddressesTemplate } from "../templates";
import { ModelProviderName } from "@moxie-protocol/core";
import { DuneClient, QueryEngine, QueryParameter, RunQueryArgs } from "@duneanalytics/client-sdk";
import { generateUniqueGroupName } from "@moxie-protocol/plugin-moxie-groups/src/utils";
import { getTokenDetails, TokenDetails } from "@moxie-protocol/moxie-agent-lib";

const client = new DuneClient(process.env.DUNE_API_KEY!);

export const earlybirdAction: Action = {
    name: "EARLYBIRD",
    similes: [
        "EARLY_BUYERS", 
        "EARLY_BIRDS", 
        "WHO_ARE_THE_EARLYBIRDS",
        "EARLY_PURCHASERS",
        "EARLY_INVESTORS",
        "FIRST_BUYERS",
        "EARLY_ADOPTERS",
        "EARLY_TOKEN_BUYERS",
        "EARLY_PURCHASERS_OF_TOKENS",
        "WHO_BOUGHT_EARLY",
        "EARLY_WALLET_ADDRESSES",
        "EARLY_BUYER_ADDRESSES"
    ],
    description: "Find wallet addresses of users who were among the very first buyers (earlybirds) of specific tokens. This action identifies early purchasers who bought tokens soon after launch, not general token information or sentiment analysis.",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (runtime: IAgentRuntime, message: Memory, state: State, _options: { [key: string]: unknown }, callback: HandlerCallback) => {
        const traceId = message.id;
        const moxieUserInfo = state.moxieUserInfo as MoxieUser;
        const moxieUserId = moxieUserInfo.id;

        try {
            elizaLogger.debug(traceId, `[EarlybirdAction] [${moxieUserId}] Starting Earlybird calculation`);
            const latestMessage = message.content.text;
            const context = composeContext({
                state: {
                    ...state,
                    latestMessage: latestMessage,
                    moxieUserId,
                },
                template: earlyBirdsTemplate,
            });

            const earlybirdsResponse = await generateObjectDeprecated({
                runtime,
                context: context,
                modelClass: ModelClass.MEDIUM,
                modelConfigOptions: {
                    modelProvider: ModelProviderName.OPENAI,
                    temperature: 0.0,
                    apiKey: process.env.OPENAI_API_KEY!,
                    modelClass: ModelClass.MEDIUM
                }
            });

            elizaLogger.debug(traceId, `[EarlybirdAction] earlybirdsResponse: ${JSON.stringify(earlybirdsResponse)}`);
            const queryId = 5802474;
            const opts: RunQueryArgs = {
                queryId,
                query_parameters: [
                    QueryParameter.number("n_buyers", 200),
                    QueryParameter.text("token1", earlybirdsResponse?.token1?.address || "0x0000000000000000000000000000000000000000"),
                    QueryParameter.text("token2", earlybirdsResponse?.token2?.address || "0x0000000000000000000000000000000000000000"),
                    QueryParameter.text("token3", earlybirdsResponse?.token3?.address || "0x0000000000000000000000000000000000000000"),
                    QueryParameter.text("token4", earlybirdsResponse?.token4?.address || "0x0000000000000000000000000000000000000000"),
                ],
                performance: QueryEngine.Large
            }
            const result = await client.runQuery(opts);
            elizaLogger.debug(traceId, `[EarlybirdAction] result: ${JSON.stringify(result)}`);
            let symbolsToFetch: string[] = [];
            if ((earlybirdsResponse?.token1?.symbol || "").trim() === "" && earlybirdsResponse?.token1?.address && earlybirdsResponse?.token1?.address.trim() !== "0x0000000000000000000000000000000000000000") {
                symbolsToFetch.push(earlybirdsResponse?.token1?.address.toLowerCase());
            }
            if ((earlybirdsResponse?.token2?.symbol || "").trim() === "" && earlybirdsResponse?.token2?.address && earlybirdsResponse?.token2?.address.trim() !== "0x0000000000000000000000000000000000000000") {
                symbolsToFetch.push(earlybirdsResponse?.token2?.address.toLowerCase());
            }
            if ((earlybirdsResponse?.token3?.symbol || "").trim() === "" && earlybirdsResponse?.token3?.address && earlybirdsResponse?.token3?.address.trim() !== "0x0000000000000000000000000000000000000000") {
                symbolsToFetch.push(earlybirdsResponse?.token3?.address.toLowerCase());
            }
            if ((earlybirdsResponse?.token4?.symbol || "").trim() === "" && earlybirdsResponse?.token4?.address && earlybirdsResponse?.token4?.address.trim() !== "0x0000000000000000000000000000000000000000") {
                symbolsToFetch.push(earlybirdsResponse?.token4?.address.toLowerCase());
            }
            let tokenDetails: TokenDetails[] = [];
            if (symbolsToFetch.length > 0) {
                tokenDetails = await getTokenDetails(symbolsToFetch);
            }

            let symbols = [
                earlybirdsResponse?.token1?.symbol || tokenDetails.find(detail => detail.tokenAddress.toLowerCase() === earlybirdsResponse?.token1?.address.toLowerCase())?.tokenSymbol || "",
                earlybirdsResponse?.token2?.symbol || tokenDetails.find(detail => detail.tokenAddress.toLowerCase() === earlybirdsResponse?.token2?.address.toLowerCase())?.tokenSymbol || "",
                earlybirdsResponse?.token3?.symbol || tokenDetails.find(detail => detail.tokenAddress.toLowerCase() === earlybirdsResponse?.token3?.address.toLowerCase())?.tokenSymbol || "",
                earlybirdsResponse?.token4?.symbol || tokenDetails.find(detail => detail.tokenAddress.toLowerCase() === earlybirdsResponse?.token4?.address.toLowerCase())?.tokenSymbol || ""
            ].filter(s => s && s.trim() !== "");

            const earlybirds = result.result.rows;
            // Filter out null-address tokens so we don't return them in the response
            // Get tokens with address present and not 0x000...0
            const nonZeroTokens = [earlybirdsResponse.token1, earlybirdsResponse.token2, earlybirdsResponse.token3, earlybirdsResponse.token4]
                .filter(t => t && t.address && t.address.trim().toLowerCase() !== "0x0000000000000000000000000000000000000000");
            if (earlybirds.length === 0) {
                await callback({
                    text: `No earlybirds found for the tokens ${
                        nonZeroTokens
                            .map(
                                t =>
                                    `$[${t.symbol || tokenDetails.find(detail => detail.tokenAddress.toLowerCase() === t.address.toLowerCase())?.tokenSymbol || ''}|${t.address}]`
                            )
                            .join(", ")
                    }`,
                    action: "EARLYBIRD",
                });
                return true;
            }
            // Extract the list of buyer addresses from the result rows
            const buyers = earlybirds.map((row: { buyer: string }) => row.buyer);
            const newContext = composeContext({
                state: {
                    ...state,
                    buyers: buyers,
                },
                template: earlybirdWalletAddressesTemplate,
            });
            elizaLogger.debug(traceId, `[EarlybirdAction] earlybirds: ${JSON.stringify(buyers)}`);
            const earlybirdWalletAddressesResponse = await generateObjectDeprecated({
                runtime,
                context: newContext,
                modelClass: ModelClass.MEDIUM,
                modelConfigOptions: {
                    modelProvider: ModelProviderName.OPENAI,
                    temperature: 0.0,
                    apiKey: process.env.OPENAI_API_KEY!,
                    modelClass: ModelClass.MEDIUM
                }
            });
            elizaLogger.debug(traceId, `[EarlybirdAction] earlybirdWalletAddressesResponse: ${JSON.stringify(earlybirdWalletAddressesResponse)}`);
            
            // Format the wallet addresses for display
            const walletAddresses = earlybirdWalletAddressesResponse?.buyers || [];
            if (walletAddresses.length > 0) {
                const formattedAddresses = walletAddresses.map(addr => `- ${addr}`).join('\n');
                await callback({ 
                    text: `Here are the earlybird wallet addresses:\n${formattedAddresses}\n`, 
                    action: "EARLYBIRD" 
                });
            } else {
                await callback({ 
                    text: "No earlybird wallet addresses found.", 
                    action: "EARLYBIRD" 
                });
                return true;
            }

            let groupBaseName: string;
            // Not all symbols may be present (token3 and token4 are optional), so only include non-empty symbol

            groupBaseName = symbols.join("_") + "_earlybirds";
            const groupName = await generateUniqueGroupName(state.authorizationHeader as string, groupBaseName);
            
            await callback({
                text: "\nLet’s create a group using these early buyers. I’ll watch their trades to trigger your strategies.",
                action: "EARLYBIRD",
                cta: "CREATE_GROUP_AND_ADD_GROUP_MEMBER",
                metadata: {
                    callbackPrompt : `Create the ${groupName} group and add all of the above users to it.`
                }
            })
            return true;
        } catch (error) {
            elizaLogger.error(traceId, `[EarlybirdAction] Error calculating earlybirds: ${error}`);
            await callback({
                text: `Error calculating earlybirds: ${error}`,
            });
            return true;
        }

    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Who are the earlybirds of $[TOKEN1|0x1234567890abcdef1234567890abcdef12345678] and $[TOKEN2|0xabcdefabcdefabcdefabcdefabcdefabcdefabcd]?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Here are the earlybird wallet addresses: [0x1234567890abcdef1234567890abcdef1234568, 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd]",
                    action: "EARLYBIRD",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Find the early buyers of $[MOXIE|0x1234567890abcdef1234567890abcdef12345678]",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Here are the earlybird wallet addresses: [0x1111111111111111111111111111111111111111, 0x2222222222222222222222222222222222222222]",
                    action: "EARLYBIRD",
                },
            },
        ],
    ] as ActionExample[][],
};