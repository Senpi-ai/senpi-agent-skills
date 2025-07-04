import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    type ActionExample,
    ModelClass,
    ModelProviderName,
    elizaLogger,
    composeContext,
    generateObjectDeprecated,
} from "@moxie-protocol/core";
import {
    MoxieClientWallet,
    MoxieUser,
    MoxieWalletClient,
    Portfolio,
} from "@moxie-protocol/moxie-agent-lib";
import {
    getErrorMessageFromCode,
    agentWalletNotFound,
    moxieWalletClientNotFound,
    checkUserCommunicationPreferences,
} from "../utils/utility";
import { stopLossTemplate } from "../templates";

export interface StopLossOrderRequest {
    success: boolean;
    is_followup: boolean;
    params: {
        stop_loss_type: "percentage" | "absolute_price_drop" | "value_loss" | "tiered_percentage";
        token_selection?: "all" | "top_N_by_balance" | null;
        top_n?: number; // Used only when token_selection is "top_N_by_balance"
        tokens?: TokenConfig[]; // Used for specifying individual token configurations
        percentage?: number; // For flat percentage-based stop loss
        absolute_price?: number; // For price-based stop loss
        value_loss_usd?: number; // For value-based stop loss
    };
    error: string | null;
}

interface TokenConfig {
    symbol?: string;
    token_address?: string;
    percentage_drop?: number; // Token-specific flat percentage drop
    absolute_price?: number;  // Token-specific absolute price
    value_loss_usd?: number;  // Token-specific value loss trigger
    tiers?: Tier[];           // Token-specific tiered stop loss
    expires_at?: string;
}

interface Tier {
    trigger_type: "percentage_drop" | "absolute_price" | "value_loss_usd";
    trigger_value: number;
    sell_percentage: number | "remaining";
}

export interface StopLossError {
    missing_fields: string[];
    prompt_message: string;
}

export interface StopLossResponse {
    success: boolean;
    params?: StopLossOrderRequest;
    error: StopLossError | null;
}

export const stopLossAction: Action = {
    name: "STOP_LOSS",
    similes: [
        "STOP_LOSS_ORDER",
    ],
    description:
        "Handles user intents related to placing stop loss orders on tokens they currently hold to prevent losses from price drops.",
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
            elizaLogger.debug(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] Starting STOP_LOSS handler with user message: ${JSON.stringify(message)}`
            );

            const agentWallet = state.agentWallet as MoxieClientWallet;

            if (!agentWallet) {
                elizaLogger.error(
                    traceId,
                    `[STOP_LOSS] [${moxieUserId}] agentWallet not found`
                );
                await callback?.(agentWalletNotFound);
                return true;
            }

            const walletClient = state.moxieWalletClient as MoxieWalletClient;
            if (!walletClient) {
                elizaLogger.error(
                    traceId,
                    `[STOP_LOSS] [${moxieUserId}] walletClient not found`
                );
                await callback?.(moxieWalletClientNotFound);
                return true;
            }

            const communicationPreference =
                await checkUserCommunicationPreferences(traceId, moxieUserId);
            elizaLogger.debug(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] communicationPreference: ${communicationPreference}`
            );

            const { tokenBalances }: Portfolio =
                (state.agentWalletBalance as Portfolio) ?? {
                    tokenBalances: [],
                };

            const tokens = tokenBalances.filter(
                (t) =>
                    t.token.balance > 0 &&
                    t.token.baseToken.address.toLowerCase() !==
                        "0x0000000000000000000000000000000000000000".toLowerCase() &&
                    t.token.baseToken.address.toLowerCase() !==
                        ETH_ADDRESS.toLowerCase()
            );

            const stopLossContext = composeContext({
                state,
                template: stopLossTemplate,
            });

            const stopLossResponse = (await generateObjectDeprecated({
                runtime,
                context: stopLossContext,
                modelClass: ModelClass.LARGE,
                modelConfigOptions: {
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                    modelProvider: ModelProviderName.ANTHROPIC,
                    apiKey: process.env.ANTHROPIC_API_KEY,
                },
            })) as StopLossResponse;

            if (!stopLossResponse.success) {
                elizaLogger.warn(
                    traceId,
                    `[STOP_LOSS] [${moxieUserId}] error occurred while performing stop loss operation: ${JSON.stringify(stopLossResponse.error)}`
                );
                callback?.({
                    text: stopLossResponse.error.prompt_message,
                    action: "STOP_LOSS",
                });
                return true;
            }

            const { params } = stopLossResponse;

            if (params.stopLossPercentage > 100) {
                callback?.({
                    text: `Please specify a stop loss percentage less than 100%. You cannot lose more than you invested.`,
                    action: "STOP_LOSS",
                });
                return true;
            }

            const stopLossParams: StopLossParams = {
                sellConditions: {
                    sellPercentage: 100,
                    priceChangePercentage: params.stopLossPercentage,
                },
                stopLossValidityInSeconds:
                    params.stopLossDurationInSec || 7 * 24 * 60 * 60,
            };

            try {
                const response = await createTradingRule(
                    state.authorizationHeader as string,
                    traceId,
                    "STOP_LOSS",
                    { sellToken: { symbol: "ETH", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" } },
                    "USER",
                    undefined,
                    undefined,
                    undefined,
                    stopLossParams
                );

                await callback?.({
                    text: `✅ Stop Loss Rule Created Successfully!\n\n📌 Instruction: ${response.instructions}`,
                    action: "STOP_LOSS",
                    cta:
                        communicationPreference === null
                            ? "SETUP_ALERTS"
                            : null,
                });
            } catch (error) {
                elizaLogger.error(
                    traceId,
                    `[STOP_LOSS] [${moxieUserId}] error creating stop loss rule: ${error.message}`
                );
                callback?.({
                    text: getErrorMessageFromCode(error),
                    action: "STOP_LOSS",
                });
            }
        } catch (error) {
            callback?.({
                text: `Something went wrong while creating stop loss rule. Please try again later.`,
                action: "STOP_LOSS",
            });
            elizaLogger.error(
                traceId,
                `[STOP_LOSS] [${moxieUserId}] error occurred while performing stop loss operation: ${JSON.stringify(error)}`
            );
        }

        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Set a stop loss order for my tokens if they drop by 10%",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Create a stop loss order to sell my tokens if they lose 15% in value",
                    action: "STOP_LOSS",
                },
            },
        ],
    ] as ActionExample[][],
};
