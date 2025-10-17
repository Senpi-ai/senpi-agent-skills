import { Action, IAgentRuntime, Memory, State, HandlerCallback, ActionExample, elizaLogger, composeContext, generateObjectDeprecated, ModelClass } from "@moxie-protocol/core";
import { MoxieUser } from "@moxie-protocol/moxie-agent-lib/src/services/types";
import { earlyBirdsTemplate, earlybirdWalletAddressesTemplate } from "../templates";
import { ModelProviderName } from "@moxie-protocol/core";
import { DuneClient, QueryParameter, RunQueryArgs } from "@duneanalytics/client-sdk";
import { generateUniqueGroupName } from "@moxie-protocol/plugin-moxie-groups/src/utils";

const client = new DuneClient(process.env.DUNE_API_KEY!);

export const earlybirdAction: Action = {
    name: "EARLYBIRD",
    similes: ["EARLY_BUYERS", "EARLY_BIRDS"],
    description: "Get the earlybirds of a set of tokens",
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
                    QueryParameter.text("token1", earlybirdsResponse.token1.address),
                    QueryParameter.text("token2", earlybirdsResponse.token2.address),
                    QueryParameter.text("token3", earlybirdsResponse.token3.address),
                    QueryParameter.text("token4", earlybirdsResponse.token4.address),
                ]
            }
            const result = await client.runQuery(opts);
            elizaLogger.debug(traceId, `[EarlybirdAction] result: ${JSON.stringify(result)}`);
            const earlybirds = result.result.rows;
            if (earlybirds.length === 0) {
                await callback({
                    text: `No earlybirds found for the tokens ${
                        [earlybirdsResponse.token1, earlybirdsResponse.token2, earlybirdsResponse.token3, earlybirdsResponse.token4]
                            .filter(t => t && t.address && t.address.trim() !== "")
                            .map(t => `$[${t.symbol || ''}|${t.address}]`)
                            .join(", ")
                    }`,
                    action: "EARLYBIRD",
                });
                return true;
            }
            const newContext = composeContext({
                state: {
                    ...state,
                    buyers: earlybirds,
                },
                template: earlybirdWalletAddressesTemplate,
            });
            elizaLogger.debug(traceId, `[EarlybirdAction] earlybirds: ${JSON.stringify(earlybirds)}`);
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
            for await (const textPart of earlybirdWalletAddressesResponse) {
                callback({ text: textPart, action: "EARLYBIRD" });
            }

            let groupBaseName: string;
            // Not all symbols may be present (token3 and token4 are optional), so only include non-empty symbols
            const symbols = [
                earlybirdsResponse?.token1?.symbol || "",
                earlybirdsResponse?.token2?.symbol || "",
                earlybirdsResponse?.token3?.symbol || "",
                earlybirdsResponse?.token4?.symbol || ""
            ].filter(s => s && s.trim() !== "");
            groupBaseName = symbols.join("_") + "_earlybirds";
            const groupName = await generateUniqueGroupName(state.authorizationHeader as string, groupBaseName);
            
            await callback({
                text: "Let’s create a group using these early buyers. I’ll watch their trades to trigger your strategies.",
                action: "EARLYBIRD",
                cta: "CREATE_GROUP_AND_ADD_GROUP_MEMBER",
                metadata: {
                    callbackPrompt : `Create the ${groupName} group and add all of the above users to it.`
                }
            })

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
                    text: "What are the earlybirds of the tokens 0x1234567890abcdef1234567890abcdef12345678 and 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "The earlybirds of the tokens 0x1234567890abcdef1234567890abcdef1234568 and 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd are 0x1234567890abcdef1234567890abcdef1234568 and 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
                    action: "EARLYBIRD",
                },
            },
        ],
    ] as ActionExample[][],
};