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
import { MoxieClientWallet, MoxieUser, MoxieWalletClient, formatUserMention } from "@moxie-protocol/moxie-agent-lib";
import { BaseParams, createTradingRule, getAutonomousTradingRuleDetails, getErrorMessageFromCode, GroupTradeParams, LimitOrderParams, RuleType, 
    UserTradeParams, agentWalletNotFound, delegateAccessNotFound, moxieWalletClientNotFound, checkUserCommunicationPreferences, Condition } from "../utils/utility";
import { autonomousTradingTemplate } from "../templates";

export interface TokenAge {
    min?: number;
    max?: number;
}

export interface MarketCap {
    min?: number;
    max?: number;
}

export interface AutonomousTradingRuleParams {
    moxieIds?: string[];
    groupId?: string;
    timeDurationInSec: number;
    amountInUSD: number;
    profitPercentage?: number;
    condition?: 'ANY' | 'ALL';
    conditionValue?: number;
    minPurchaseAmount?: number;
    sellTriggerType?: 'LIMIT_ORDER' | 'COPY_SELL' | 'BOTH';
    sellTriggerCondition?: 'ANY' | 'ALL';
    sellTriggerCount?: number;
    sellPercentage?: number;
    tokenAge?: TokenAge;
    marketCap?: MarketCap;
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
    description: "Select this action when a specific trading rule is being set up, including details like specific wallets to follow, token amounts, time conditions, or other specific parameters for automated trades. Example: 'Buy 10$ worth tokens whenever @[betashop|M4] and @[jessepollak|M739] buy minimum of $50 of any token in 6 hours.",
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
            elizaLogger.debug(traceId,`[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] Starting AUTONOMOUS_TRADING handler with user message: ${JSON.stringify(message)}`);

            // read moxieUserInfo from state
            const agentWallet = state.agentWallet as MoxieClientWallet;

            if (!agentWallet) {
                elizaLogger.error(traceId,`[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] agentWallet not found`);
                await callback?.(agentWalletNotFound);
                return true;
            }

            if (!agentWallet.delegated) {
                elizaLogger.error(traceId,`[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] agentWallet is not delegated`);
                await callback?.(delegateAccessNotFound);
                return true;
            }

            const walletClient = state.moxieWalletClient as MoxieWalletClient;
            if (!walletClient) {
                elizaLogger.error(traceId,`[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] walletClient not found`);
                await callback?.(moxieWalletClientNotFound);
                return true;
            }

            const communicationPreference = await checkUserCommunicationPreferences(traceId, moxieUserId);
            elizaLogger.debug(traceId,`[AUTONOMOUS_TRADING] [${moxieUserId}] [AUTONOMOUS_TRADING] [checkUserCommunicationPreferences] communicationPreference: ${communicationPreference}`);

            // Compose autonomous trading context
            // Compose swap context
            const swapContext = composeContext({
                state,
                template: autonomousTradingTemplate,
            });

            // Generate swap content
            const autonomousTradingResponse = await generateObjectDeprecated({
                runtime,
                context: swapContext,
                modelClass: ModelClass.LARGE,
                modelConfigOptions: {
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                    modelProvider: ModelProviderName.ANTHROPIC,
                    apiKey: process.env.ANTHROPIC_API_KEY,
                    modelClass: ModelClass.LARGE,
                }
            }) as AutonomousTradingResponse;

            if (!autonomousTradingResponse.success ) {
                elizaLogger.warn(traceId,`[autonomous trading] [${moxieUserId}] [AUTONOMOUS_TRADING] [ADD_RULE] error occured while performing add rule operation: ${JSON.stringify(autonomousTradingResponse.error)}`);
                 callback?.({
                    text: autonomousTradingResponse.error.prompt_message,
                    action: "AUTONOMOUS_TRADING",
                });
                return true;
            }

            // Extract parameters from response
            const {ruleType, params} = autonomousTradingResponse;
            
            const baseParams: BaseParams = {
                buyAmount: params.amountInUSD,
                duration: params.timeDurationInSec,
                buyAmountValueType: 'USD',
                sellToken:  {
                    symbol: 'ETH',
                    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
                },
                tokenMetrics: (params.tokenAge || params.marketCap) ? {
                    tokenAge: params.tokenAge ? {
                        min: params.tokenAge?.min,
                        max: params.tokenAge?.max
                    } : undefined,
                    marketCap: params.marketCap ? {
                        min: params.marketCap?.min,
                        max: params.marketCap?.max
                    } : undefined
                } : undefined
            };

            if (params.sellTriggerType === 'COPY_SELL' || params.sellTriggerType === 'BOTH') {
                baseParams.sellConfig = {
                    buyToken: {
                        symbol: 'ETH',
                        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
                    },
                    // triggerPercentage: params.sellPercentage,
                    triggerPercentage: 50, // Hardcoded for now
                    condition: params.sellTriggerCondition === 'ANY' ? Condition.ANY : Condition.ALL,
                    conditionValue: params.sellTriggerCount
                };
            };

            let groupTradeParams: GroupTradeParams;
            let userTradeParams: UserTradeParams;
            let limitOrderParams: LimitOrderParams;
            let ruleTriggers: 'GROUP' | 'USER';

            if (ruleType === 'GROUP_COPY_TRADE' || ruleType === 'GROUP_COPY_TRADE_AND_PROFIT') {
                ruleTriggers = 'GROUP';

                if (params.condition === 'ANY' && params.sellTriggerCount > params.conditionValue) {
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
                        valueType: 'USD',
                        amount: params.minPurchaseAmount || 0
                    }
                };
            } else {
                ruleTriggers = 'USER';
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
                        valueType: 'USD',
                        amount: params.minPurchaseAmount || 0
                    }
                };
            }

            if (ruleType === 'GROUP_COPY_TRADE_AND_PROFIT' || ruleType === 'COPY_TRADE_AND_PROFIT') {
                limitOrderParams = {
                    sellConditions: {
                        sellPercentage: 100,
                        priceChangePercentage: params.profitPercentage
                    },
                    limitOrderValidityInSeconds: 7 * 24 * 60 * 60 // 7 days in seconds
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
                    limitOrderParams
                );

                await callback?.({
                    text: `✅ Automation Rule Created Successfully!\n\n📌 Instruction: ${response.instructions}`,
                     action: "AUTONOMOUS_TRADING",
                     cta: communicationPreference === null ? "SETUP_ALERTS" : null
                });

            } catch (error) {
                elizaLogger.error(traceId,`[autonomous trading] [${moxieUserId}] [AUTONOMOUS_TRADING] [ADD_RULE] error creating trading rule: ${error.message}`);
                callback?.({
                    text: getErrorMessageFromCode(error),
                    action: "AUTONOMOUS_TRADING",
                });
            }

                
        } catch(error) {
            callback?.({
                text: `Something went wrong while creating autonomous trading rule. Please try again later.`,
                action: "AUTONOMOUS_TRADING",
            });
            elizaLogger.error(traceId,`[[autonomous trading]] [${moxieUserId}] [AUTONOMOUS_TRADING] [ADD_RULE] error occured while performing add rule operation: ${JSON.stringify(error)}`);

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
    description: "Select this action when the request is seeking information about possible automation types, available parameters, or general questions about what copy trading functionality exists. Example: 'What automations are possible?' or 'What kinds of trading rules can I create?",
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

        const response = getAutonomousTradingRuleDetails(formatUserMention(user.id, user.userName));
        callback({
            text: response, 
            action: "COPY_TRADE_RULE_DETAILS",
            cta: ["COPY_TRADE", "GROUP_COPY_TRADE", "AUTO_BUY_AUTO_SELL"]
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
