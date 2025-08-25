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
    formatUserMention,
} from "@moxie-protocol/moxie-agent-lib";
import {
    BaseParams,
    createTradingRule,
    getAutonomousTradingRuleDetails,
    getErrorMessageFromCode,
    GroupTradeParams,
    LimitOrderParams,
    RuleType,
    StopLossParams,
    UserTradeParams,
    agentWalletNotFound,
    moxieWalletClientNotFound,
    checkUserCommunicationPreferences,
    Condition,
} from "../utils/utility";
import { autonomousTradingTemplate } from "../templates";
import { validate } from "uuid";

export type TokenAge = number | {
    min?: number;
    minAgeInSec?: number;
    max?: number;
    maxAgeInSec?: number;
};

export type MarketCap = number | {
    min?: number;
    minMarketCapInUSD?: number;
    max?: number;
    maxMarketCapInUSD?: number;
};

export interface AutonomousTradingRuleParams {
    moxieIds?: string[];
    groupId?: string;
    timeDurationInSec: number;
    amountInUSD: number;
    profitPercentage?: number;
    condition?: "ANY" | "ALL";
    conditionValue?: number;
    minPurchaseAmount?: number;
    sellTriggerType?: "LIMIT_ORDER" | "STOP_LOSS" | "BOTH";
    sellTriggerCondition?: "ANY" | "ALL";
    sellTriggerCount?: number;
    sellPercentage?: number;
    tokenAge?: TokenAge;
    marketCap?: MarketCap;
    stopLossPercentage?: number;
    stopLossDurationInSec?: number;
}

export interface AutonomousTradingError {
    missing_fields: string[];
    prompt_message: string;
}

export interface AutonomousTradingResponse {
    success: boolean;
    ruleType?: string;
    is_followup: boolean;
    params?: AutonomousTradingRuleParams;
    error: AutonomousTradingError | null;
}

export const autonomousTradingAction: Action = {
    name: "AUTONOMOUS_TRADING",
    similes: [
        "COPY_TRADE",
        "COPY_TRADES",
        "COPY_TRADE_WITH_PROFIT",
        "GROUP_COPY_TRADE",
        "GROUP_COPY_TRADES",
        "GROUP_COPY_TRADE_WITH_PROFIT",
    ],
    description:
        "Select this action only when the trading rule involves copying trades from specific users or groups. This includes scenarios where you follow specific wallets, set token amounts, or define time conditions for automated trades. Do not use it if it is not about copy trades. Example: 'Buy $10 worth of tokens whenever @[betashop|M4] and @[jessepollak|M739] buy a minimum of $50 of any token within 6 hours.'",
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
                `[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] Starting AUTONOMOUS_TRADING handler with user message: ${JSON.stringify(message)}`
            );

            // read moxieUserInfo from state
            const agentWallet = state.agentWallet as MoxieClientWallet;

            if (!agentWallet) {
                elizaLogger.error(
                    traceId,
                    `[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] agentWallet not found`
                );
                await callback?.(agentWalletNotFound);
                return true;
            }

            const walletClient = state.moxieWalletClient as MoxieWalletClient;
            if (!walletClient) {
                elizaLogger.error(
                    traceId,
                    `[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] walletClient not found`
                );
                await callback?.(moxieWalletClientNotFound);
                return true;
            }

            const communicationPreference =
                await checkUserCommunicationPreferences(traceId, moxieUserId);
            elizaLogger.debug(
                traceId,
                `[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] [checkUserCommunicationPreferences] communicationPreference: ${communicationPreference}`
            );

            // Compose autonomous trading context
            // Compose swap context
            const swapContext = composeContext({
                state,
                template: autonomousTradingTemplate,
            });

            // Generate swap content
            const autonomousTradingResponse = (await generateObjectDeprecated({
                runtime,
                context: swapContext,
                modelClass: ModelClass.LARGE,
                modelConfigOptions: {
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                    modelProvider: ModelProviderName.ANTHROPIC,
                    apiKey: process.env.ANTHROPIC_API_KEY,
                    modelClass: ModelClass.LARGE,
                },
            })) as AutonomousTradingResponse;

            if (!autonomousTradingResponse.success) {
                elizaLogger.warn(
                    traceId,
                    `[autonomous trading] [${moxieUserId}] [AUTONOMOUS_TRADING] [ADD_RULE] error occured while performing add rule operation: ${JSON.stringify(autonomousTradingResponse.error)}`
                );
                callback?.({
                    text: autonomousTradingResponse.error.prompt_message,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            // Extract parameters from response
            let { ruleType, params } = autonomousTradingResponse;

            if (
                params.moxieIds &&
                params.moxieIds.length > 1 &&
                !params.timeDurationInSec
            ) {
                callback?.({
                    text: `Please specify the duration between which copied traders make trades to be counted for the rule`,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            if (
                params.conditionValue &&
                params.conditionValue > 1 &&
                !params.timeDurationInSec
            ) {
                callback?.({
                    text: `Please specify the duration between which copied traders make trades to be counted for the rule`,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            if (
                params.condition === "ALL" &&
                !params.timeDurationInSec
            ) {
                callback?.({
                    text: `Please specify the duration between which copied traders make trades to be counted for the rule`,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            if (params.stopLossPercentage && params.stopLossPercentage > 100) {
                callback?.({
                    text: `Please specify a stop loss percentage less than 100%. You can not lose more than you invested.`,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            if (!params.amountInUSD) {
                callback?.({
                    text: `Please specify the amount of tokens in USD you want the agent to buy.`,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            if (params.groupId && !validate(params.groupId)) {
                callback?.({
                    text: `Please provide a valid group in the following format: #groupname. Remember to select the group from the dropdown and press 'Enter' to confirm.`,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            const baseParams: BaseParams = {
                buyAmount: params.amountInUSD,
                duration: params.timeDurationInSec,
                buyAmountValueType: "USD",
                sellToken: {
                    symbol: "ETH",
                    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                },
                // This code checks if either tokenAge or marketCap is present in params.
                // If so, it constructs a tokenMetrics object with min/max values for each, handling both object and number types.
                // If neither is present, tokenMetrics is undefined.
                tokenMetrics:
                    params.tokenAge || params.marketCap
                        ? {
                              tokenAge:
                                  typeof params.tokenAge === "object"
                                      ? {
                                            min:
                                                params.tokenAge?.min ??
                                                params.tokenAge?.minAgeInSec ??
                                                null,
                                            max:
                                                params.tokenAge?.max ??
                                                params.tokenAge?.maxAgeInSec ??
                                                null,
                                        }
                                      : typeof params.tokenAge === "number"
                                      ? {
                                            min: params.tokenAge,
                                            max: null,
                                        }
                                      : undefined,
                              marketCap:
                                  typeof params.marketCap === "object"
                                      ? {
                                            min:
                                                params.marketCap?.min ??
                                                params.marketCap?.minMarketCapInUSD ??
                                                null,
                                            max:
                                                params.marketCap?.max ??
                                                params.marketCap?.maxMarketCapInUSD ??
                                                null,
                                        }
                                      : typeof params.marketCap === "number"
                                      ? {
                                            min: params.marketCap,
                                            max: null,
                                        }
                                      : undefined,
                          }
                        : undefined,
            };

            if (
                ruleType === "COPY_TRADE_AND_PROFIT" ||
                ruleType === "GROUP_COPY_TRADE_AND_PROFIT"
            ) {
                if (params.profitPercentage === undefined || params.profitPercentage === null) {
                    if (ruleType === "COPY_TRADE_AND_PROFIT") {
                        ruleType = "COPY_TRADE";
                    }
                    if (ruleType === "GROUP_COPY_TRADE_AND_PROFIT") {
                        ruleType = "GROUP_COPY_TRADE";
                    }
                }
            }

            if (params?.sellTriggerCondition || params?.sellTriggerCount) {
                let sellCondition = params.sellTriggerCondition === "ANY" ? Condition.ANY : Condition.ALL;

                // If sellCondition is ANY while params.condition is ALL, and sellTriggerCount is not set, default to 1
                if (
                    sellCondition === Condition.ANY &&
                    params.condition === "ALL" &&
                    (params.sellTriggerCount === undefined || params.sellTriggerCount === null)
                ) {
                    params.sellTriggerCount = 1;
                }

                let sellConditionValue = params.sellTriggerCount;

                // If sellTriggerCondition is ANY and sellTriggerCount is not provided, throw error
                if (
                    params.sellTriggerCondition === "ANY" &&
                    (params.sellTriggerCount === undefined || params.sellTriggerCount === null)
                ) {
                    callback?.({
                        text: `I'm unable to understand your copy sell condition. Could you please clarify how you want the sell triggers (number of members, all or any) to work?`,
                        action: "AUTONOMOUS_TRADING",
                    });
                    return true;
                }

                // If sellTriggerCondition is ALL and sellTriggerCount is not provided
                if (
                    params.sellTriggerCondition === "ALL" &&
                    (params.sellTriggerCount === undefined || params.sellTriggerCount === null)
                ) {
                    // Check if params.condition is ANY and params.conditionValue is provided
                    if (
                        params.condition === "ANY" &&
                        params.conditionValue !== undefined &&
                        params.conditionValue !== null
                    ) {
                        sellConditionValue = params.conditionValue;
                    } else {
                        callback?.({
                            text: `I'm unable to understand your copy sell condition. Could you please clarify how you want the sell triggers to work?`,
                            action: "AUTONOMOUS_TRADING",
                        });
                        return true;
                    }
                }

                // If params.condition is ALL and params.sellTriggerCondition is ALL, throw error
                if (
                    params.condition === "ALL" &&
                    params.sellTriggerCondition === "ALL"
                ) {
                    callback?.({
                        text: `Both your buy and sell conditions are set to ALL, which I can't process. Please clarify your sell condition by specifying the number of member sells that should trigger a sell for you.`,
                        action: "AUTONOMOUS_TRADING",
                    });
                    return true;
                }

                baseParams.sellConfig = {
                    buyToken: {
                        symbol: "ETH",
                        address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                    },
                    // triggerPercentage: params.sellPercentage,
                    triggerPercentage: 50, // Hardcoded for now
                    condition: sellCondition,
                    conditionValue: sellConditionValue,
                };
            }

            let groupTradeParams: GroupTradeParams;
            let userTradeParams: UserTradeParams;
            let limitOrderParams: LimitOrderParams;
            let stopLossParams: StopLossParams;

            let ruleTriggers: "GROUP" | "USER";

            if (
                ruleType === "GROUP_COPY_TRADE" ||
                ruleType === "GROUP_COPY_TRADE_AND_PROFIT"
            ) {
                ruleTriggers = "GROUP";

                if (
                    params.condition === "ANY" &&
                    params.sellTriggerCount > params.conditionValue
                ) {
                    callback?.({
                        text: `The sell trigger count exceeds the numbers of members in the group you are tracking.Please try again with a lower sell trigger count.`,
                        action: "AUTONOMOUS_TRADING",
                    });
                    return true;
                }

                groupTradeParams = {
                    groupId: params.groupId,
                    condition: params.condition,
                    conditionValue: params.conditionValue,
                    minPurchaseAmount: {
                        valueType: "USD",
                        amount: params.minPurchaseAmount || 0,
                    },
                };
            } else {
                ruleTriggers = "USER";
                if (params.sellTriggerCount > params.moxieIds.length) {
                    callback?.({
                        text: `The number of users you are tracking is less than the number of users you are setting the sell trigger count to. Please try again with a lower sell trigger count.`,
                        action: "AUTONOMOUS_TRADING",
                    });
                    return true;
                }
                userTradeParams = {
                    moxieUsers: params.moxieIds,
                    minPurchaseAmount: {
                        valueType: "USD",
                        amount: params.minPurchaseAmount || 0,
                    },
                };
            }

            if (
                ruleType === "GROUP_COPY_TRADE_AND_PROFIT" ||
                ruleType === "COPY_TRADE_AND_PROFIT"
            ) {
                limitOrderParams = {
                    sellConditions: {
                        sellPercentage: 100,
                        priceChangePercentage: params.profitPercentage,
                    },
                    limitOrderValidityInSeconds: 7 * 24 * 60 * 60, // 7 days in seconds
                };
            }

            if (params.stopLossPercentage) {
                stopLossParams = {
                    sellConditions: {
                        sellPercentage: 100,
                        priceChangePercentage: params.stopLossPercentage,
                    },
                    stopLossValidityInSeconds:
                        params.stopLossDurationInSec || 7 * 24 * 60 * 60,
                };
            }

            try {
                const response = await createTradingRule(
                    state.authorizationHeader as string,
                    traceId,
                    ruleType as RuleType,
                    baseParams,
                    ruleTriggers,
                    groupTradeParams,
                    userTradeParams,
                    limitOrderParams,
                    stopLossParams
                );

                await callback?.({
                    text: `✅ Automation Rule Created Successfully!\n\n📌 Instruction: ${response.instructions}`,
                    action: "AUTONOMOUS_TRADING",
                    cta:
                        communicationPreference === null
                            ? "SETUP_ALERTS"
                            : null,
                });
            } catch (error) {
                elizaLogger.error(
                    traceId,
                    `[autonomous trading] [${moxieUserId}] [AUTONOMOUS_TRADING] [ADD_RULE] error creating trading rule: ${error.message}`
                );
                callback?.({
                    text: getErrorMessageFromCode(error),
                    action: "AUTONOMOUS_TRADING",
                });
            }
        } catch (error) {
            callback?.({
                text: `Something went wrong while creating autonomous trading rule. Please try again later.`,
                action: "AUTONOMOUS_TRADING",
            });
            elizaLogger.error(
                traceId,
                `[[autonomous trading]] [${moxieUserId}] [AUTONOMOUS_TRADING] [ADD_RULE] error occured while performing add rule operation: ${JSON.stringify(error)}`
            );
        }

        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "buy 10$ worth tokens whenever @betashop and @jessepollak buy any token in 6 hours",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "buy 10$ worth tokens whenever @betashop and @jessepollak buy any token in 6 hours and sell it off when it makes a profit of 40%",
                    action: "AUTONOMOUS_TRADING",
                },
            },
        ],
    ] as ActionExample[][],
};

export const getAutonomousTradingRuleDetailAction: Action = {
    name: "COPY_TRADE_RULE_DETAILS",
    similes: ["AUTONOMOUS_TRADING_RULE_DETAILS"],
    description:
        "Select this action when the request is seeking information about possible automation types, available parameters, or general questions about what copy trading functionality exists. Example: 'What automations are possible?' or 'What kinds of trading rules can I create?",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        const user = state.moxieUserInfo as MoxieUser;

        const response = getAutonomousTradingRuleDetails(
            formatUserMention(user.id, user.userName)
        );
        callback({
            text: response,
            action: "COPY_TRADE_RULE_DETAILS",
            cta: ["COPY_TRADE", "GROUP_COPY_TRADE", "AUTO_BUY_AUTO_SELL"],
        });
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "get details for a copy trade rule",
                },
            },
        ],
    ] as ActionExample[][],
};
