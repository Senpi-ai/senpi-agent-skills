import { elizaLogger } from '@moxie-protocol/core';
import { gql } from 'graphql-request';

export type RuleType = 'COPY_TRADE' | 'COPY_TRADE_AND_PROFIT' | 'GROUP_COPY_TRADE' | 'GROUP_COPY_TRADE_AND_PROFIT';

export interface SellToken {
    symbol: string;
    address: string;
}

export interface BuyToken {
    symbol: string;
    address: string;
}

export interface Amount {
    valueType: 'USD';
    amount: number;
}

export enum Condition {
    ALL = "ALL",
    ANY = "ANY"
}

export interface SellConfig {
    buyToken: BuyToken;
    triggerPercentage: number;
    condition: Condition;
    conditionValue?: number;
}

export interface TokenAge {
    min?: number;
    max?: number;
}

export interface MarketCap {
    min?: number;
    max?: number;
}

export interface TokenMetrics {
    tokenAge?: TokenAge;
    marketCap?: MarketCap;
}

export interface BaseParams {
    buyAmount: number;
    duration: number;
    buyAmountValueType: 'USD';
    sellToken: SellToken;
    sellConfig?: SellConfig;
    tokenMetrics?: TokenMetrics;
}

export interface LimitOrderParams {
    sellConditions: {
        sellPercentage: number;
        priceChangePercentage: number;
    };
    limitOrderValidityInSeconds: number;
}

export interface StopLossParams {
    sellConditions: {
        sellPercentage: number;
        priceChangePercentage: number;
    };
    stopLossValidityInSeconds: number;
}

export interface GroupTradeParams {
    groupId: string;
    condition: 'ANY' | 'ALL';
    conditionValue: number;
    minPurchaseAmount: Amount
}

export interface UserTradeParams {
    moxieUsers: string[];
    minPurchaseAmount: Amount;
}

export interface CreateRuleInput {
    requestId: string;
    ruleType: RuleType;
    ruleParameters: {
        baseParams: BaseParams;
        limitOrderParams?: LimitOrderParams;
        stopLossParams?: StopLossParams;
        groupTradeParams?: GroupTradeParams;
        userTradeParams?: UserTradeParams;
    };
    ruleTrigger: 'GROUP' | 'USER';
}

export type Group = {
    id: string;
    name: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    members: GroupMember[];
    status: Status;
}

export interface GroupMember {
    moxieUserId: string;
    createdAt: string;
    updatedAt: string;
    status: Status;
}

export enum Status {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE"
}

export interface GetGroupsOutput {
    groups: Group[];
    pagination: Pagination;
}

export interface Pagination {
    total: number;
    skip: number;
    take: number;
}

export interface CreateRuleResponse {
    id: string;
    requestId: string;
    ruleType: string;
    status: string;
    instructions: string;
}

export interface GetGroupsInput {
    groupId?: string;
    groupName?: string;
    skip?: number;
    take?: number;
}

const mutation = gql`
    mutation CreateRule($createRuleInput: CreateRuleInput!) {
        CreateRule(input: $createRuleInput) {
            id
            requestId
            ruleType
            status
            instructions
        }
    }
`;

export const GET_GROUP_DETAILS = gql`
    query GetGroups($input: GetGroupsInput!) {
        GetGroups(input: $input) {
            groups {
                id
                name
                createdBy
                members {
                    moxieUserId
                }
            }
        }
    }
`;

// errorMessages.ts

const errorMessages: Record<string, string> = {
    AERR001: "Some required fields are missing. Please make sure you've provided all the necessary details.",
    AERR002: "We couldn’t understand who should trigger the rule — is it an copy trade or a group copy trade?",
    AERR003: "We need basic trading details to create this rule. Please add those.",
    AERR004: "The amount to buy must be more than zero.",
    AERR005: "Please choose whether the buy amount is in dollars.",
    AERR006: "Duration must be a positive number (like minutes or hours or seconds).",
    AERR007: "The token name you're selling to buy incoming tokens is missing. Please provide it.",
    AERR008: "The address of the token you're selling to buy incoming tokens is missing. Please add it.",
    AERR009: "The token address which you're selling to buy incoming tokens doesn't look right. Please check if it's a valid wallet address.",
    AERR010: "We need user-specific trade details to continue. (e.g. @username)",
    AERR011: "The minimum purchase amount must be a positive number.",
    AERR012: "Please choose if the minimum amount is in dollars.",
    AERR013: "To use a group-based rule, group details are needed. (e.g. #groupname)",
    AERR014: "At least one user must be selected to copy trades from.",
    AERR015: "You're using a user-based rule — group settings should not be included.",
    AERR016: "You cannot copy trades from yourself.",
    AERR017: "Missing group-based settings. Please provide group ID and conditions.",
    AERR018: "Group rules must include both the group and the condition (like ALL or ANY).",
    AERR019: "Please tell us how many members should meet the condition.",
    AERR020: "The condition value must be zero or higher.",
    AERR021: "You’re using a group rule — user-based settings should not be included.",
    AERR022: "To use profit-taking, please define when to sell.",
    AERR023: "At least one sell condition (e.g., price goes up by 10%) is required.",
    AERR024: "Both price change % and sell % must be numbers.",
    AERR025: "The profit percentage must be more or equal to 1.",
    AERR026: "The sell percentage must be more or equal to 1.",
    AERR027: "Set how long the limit order should stay active — it must be a positive number.",
    AERR028: "Limit order settings are only allowed for profit-taking rules.",
    AERR029: "Please provide sell conditions to enable profit-taking.",
    AERR030: "We couldn’t generate the rule’s instructions. Please check the details.",
    AERR031: "You’re not authorized. Please sign in again.",
    AERR032: "We couldn’t find your user account. Please try reconnecting.",
    AERR033: "We had trouble fetching your rules. Please try again shortly.",
    AERR034: "Something went wrong while creating the rule. Please try again.",
    AERR035: "We couldn’t delete one or more rules. Please make sure you created them.",
    AERR036: "We had trouble loading your automation logs. Please try again.",
    AERR037: "We couldn’t find the group. Please check the group ID.",
    AERR038: "You’ve set a condition that’s higher than the number of people in the group.",
    AERR039: "The token name you're selling to from the token you bought is missing. Please provide it.",
    AERR040: "The address of the token you're selling to from the token you bought is missing. Please add it.",
    AERR041: "The address of the token you're selling to from the token you bought is not a valid Base address. Please add a valid address.",
    AERR042: "The trigger percentage must be a positive number",
    AERR043: "The condition for selling is a mandatory field. Please provide it.",
    AERR044: "The sell condition value must be a non-negative number",
    AERR045: "Number of users for sell condition is provided bigger than the actual users in the rule. Please provide lower number.",
    AERR046: "Number of users for sell condition is provided bigger than actual users in the group. Please provide lower number.",
    AERR050: "At least one user must be selected to copy trades from.",
    AERR051: "Please check if valid Senpi user is tagged e.g. @[betashop.eth|M4].",
    AERR052: "Minimum token age and maximum token age must be non-negative numbers",
    AERR053: "Minimum market cap and maximum market cap must be non-negative numbers",
    AERR054: "Minimum token age must be less than maximum token age",
    AERR055: "Minimum market cap must be less than maximum market cap",
    AERR201: "Please try again with a valid group. Make sure to use '#' to select from your available groups. You can also ask me to create a new group by typing: create the group [groupname]",
    AERR202: "Please add members to the group before setting up auto-trading. For example: add @betashop.eth to #copytrade",
    AERR203: "Hi, I'd be happy to help you setup that auto-trade but there are less members in the group than the copy traded users count. You can ask me to add more members by typing: add [user] to [groupname]",
    AERR204: "Hi, I'd be happy to help you setup that auto-trade but there are less members in the group than the sell condition value. You can ask me to add more members by typing: add [user] to [groupname]",
};

export function getErrorMessageFromCode(error: Error | string): string {
    const errorMsg = typeof error === "string" ? error : error.message;
    const match = errorMsg.match(/(AERR\d{3})/);
    const code = match?.[1];
    if (code && errorMessages[code]) {
        return errorMessages[code];
    } else {
        return `Hi, I'd be happy to help you setup that auto-trade but we just need some more information first. \n&nbsp;\n

1. Make sure to specify who triggers the copy trade. Examples: if @[user] buys a token or if 2 people in #groupname. 
2. Make sure to specify a trigger amount: e.g. if 2 people in #copytrade buy >$1000 of a token.
3. Make sure to specify a time period, e.g. "if 2 people in #copytrade buy >$1000 of a token within 30 minutes of each other..."
4. Make sure to specify an amount to buy for you: "if 2 people in #copytrade buy >$1000 of a token within 30 minutes of each other, buy me $400 of it..."
5. Optional: Let me know if you have any exit conditions, e.g. "and then sell all when the price increases by 30%, or sell when they sell"

\n&nbsp;\n
**Here is a fully formed complete auto-trade instruction:**
If 2 people in #copytrade buy >$1000 of a token within 30 minutes of each other, buy me $400 of it, and then sell when they sell or when the price has increased by 30%`;
    }
}


export async function createTradingRule(
    authorizationHeader: string,
    requestId: string,
    ruleType: RuleType,
    baseParams: BaseParams,
    ruleTrigger: 'GROUP' | 'USER',
    groupTradeParams?: GroupTradeParams,
    userTradeParams?: UserTradeParams,
    limitOrderParams?: LimitOrderParams,
    stopLossParams?: StopLossParams
): Promise<CreateRuleResponse> {

    // Ensure either groupTradeParams or userTradeParams is provided, but not both
    if (ruleTrigger === 'GROUP' && !groupTradeParams) {
        throw new Error('Please provide groupTradeParams (e.g. #groupname, condition: ANY|ALL, conditionValue: number, minPurchaseAmount: number) when using a GROUP rule.');
    }

    if (ruleTrigger === 'USER' && !userTradeParams) {
        throw new Error('Please provide userTradeParams (e.g. @username, minPurchaseAmount: number) when using a USER rule.');
    }

    if (groupTradeParams && userTradeParams) {
        throw new Error('Provide only one: groupTradeParams or userTradeParams, not both.');
    }

    const createRuleInput: CreateRuleInput = {
        requestId,
        ruleType,
        ruleParameters: {
            baseParams
        },
        ruleTrigger
    };

    if (limitOrderParams) {
        createRuleInput.ruleParameters.limitOrderParams = limitOrderParams;
    }

    if (stopLossParams) {
        createRuleInput.ruleParameters.stopLossParams = stopLossParams;
    }

    if (groupTradeParams) {
        createRuleInput.ruleParameters.groupTradeParams = groupTradeParams;
        const groupDetails = await getGroupDetails(authorizationHeader, groupTradeParams.groupId);

        if (groupDetails.groups.length === 0) {
            throw new Error('AERR201: Group not found. Please check the group ID.');
        }

        const groupMembersLength = groupDetails.groups[0].members.length;

        if (groupMembersLength === 0) {
            throw new Error('AERR202: The group has no members. Please add members to the group.');
        }

        if (groupTradeParams.condition === 'ANY' && groupMembersLength < groupTradeParams.conditionValue) {
            throw new Error('AERR203: The number of users in the group is less than the buy condition value. Please provide a lower condition value.');
        }

        if (createRuleInput?.ruleParameters?.baseParams?.sellConfig && groupMembersLength < createRuleInput.ruleParameters.baseParams.sellConfig.conditionValue) {
            throw new Error('AERR204: The number of users in the group is less than the sell condition value. Please provide a lower condition value.');
        }

    }

    if (userTradeParams) {
        createRuleInput.ruleParameters.userTradeParams = userTradeParams;
    }

    try {
        const response = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: mutation,
                variables: { createRuleInput }
            })
        });

        const result = await response.json();

        if (result.errors) {
            throw new Error(`Failed to create rule: ${result.errors[0].message}`);
        }

        return result.data.CreateRule as CreateRuleResponse;

    } catch (error) {
        elizaLogger.error(`CreateRule failed: ${error}`);
        throw new Error(`Error creating trading rule: ${error.message}`);
    }
}

export const getAutonomousTradingRuleDetails = (currentUser: string) => `Hi There!\n&nbsp;\nI can help you easily set up auto-trading — so you never miss that alpha. Here are some examples of auto-trades I can currently do:\n&nbsp;\n\n1. **Buy when someone else buys**\nIf @betashop.eth and @jessepollak buy >500 of a token with 30 minutes of each other, then buy me $100 of it.\n\n2. **Buy when group buys**\nIf 3 people #copytrade buy >$500 of the same token within 20 mins of each other, then buy me $100 of it.\n\n3. **Auto-Buy then Auto-Sell**\nIf 3 people #copytrade buy >$500 of the same token within 20 mins of each other, then buy me $100 of it, and then sell all when 2 of them sell or when it increases by 30%.\n\n&nbsp;\nGo to Groups to set up your #copytrade group and create additional groups.\n&nbsp;\nThen just use #[groupname] to create your auto-trade rules!\n&nbsp;\nCopy and edit the prompts above or start with one of the templates below — just tweak it to fit your strategy!`;


export const agentWalletNotFound = {
    text: `\nPlease make sure to set up your agent wallet first and try again.`,
};

export const delegateAccessNotFound = {
    text: `\nPlease make sure to set up your agent wallet first and try again. (delegate access not found)`,
};

export const moxieWalletClientNotFound = {
    text: `\nUnable to access moxie wallet details. Please ensure your moxie wallet is properly setup and try again.`,
};

export async function checkUserCommunicationPreferences(traceId: string, moxieUserId: string): Promise<string | null> {
    try {
        const response = await fetch(process.env.MOXIE_API_URL_INTERNAL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `
                    query GetUser {
                        GetUser(input: { userId: "${moxieUserId}" }) {
                            communicationPreference
                        }
                    }
                `
            })
        });

        if (!response.ok) {
            elizaLogger.error(traceId, `[AUTONOMOUS_TRADING] [${moxieUserId}] Failed to fetch user preferences: ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        elizaLogger.debug(traceId, `[AUTONOMOUS_TRADING] [${moxieUserId}] User communication preferences:`, data?.data?.GetUser?.communicationPreference);
        return data?.data?.GetUser?.communicationPreference;

    } catch (error) {
        elizaLogger.error(traceId, `[AUTONOMOUS_TRADING] [${moxieUserId}] Error checking user preferences: ${error.message}`);
        return null;
    }
}

export async function getGroupDetails(
    authorizationHeader: string,
    groupId?: string,
    groupName?: string,
    skip: number = 0,
    take: number = 10,
): Promise<GetGroupsOutput> {
    elizaLogger.info('getGroupDetails called', { groupId, groupName, skip, take });

    try {
        const input: GetGroupsInput = {
            ...(groupId && { groupId }),
            ...(groupName && { groupName }),
            ...(skip !== undefined && { skip }),
            ...(take !== undefined && { take })
        };

        elizaLogger.debug('getGroupDetails input constructed', { input });

        const data = await fetch(process.env.RULE_API_MOXIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorizationHeader
            },
            body: JSON.stringify({
                query: GET_GROUP_DETAILS,
                variables: { input }
            })
        });

        elizaLogger.debug('getGroups fetch completed', { status: data.status });

        const result = await data.json();
        if (result.errors) {
            elizaLogger.error('getGroups failed', { errors: result.errors });
            throw new Error(`Failed to get groups: ${result.errors[0].message}`);
        }

        elizaLogger.info('getGroups successful', { data: result.data.GetGroups });
        return result.data.GetGroups;
    } catch (error) {
        elizaLogger.error('Error in getGroups', { error: error.message });
        throw new Error(`Error fetching groups: ${error.message}`);
    }
}