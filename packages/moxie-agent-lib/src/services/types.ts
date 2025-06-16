import { State } from "@moxie-protocol/core";
import { IAgentRuntime } from "@moxie-protocol/core";
import { Wallet as PrivyWallet } from "@privy-io/server-auth";
import { ethers } from "ethers";
import { MoxieClientWallet, MoxieWalletClient } from "../wallet";
export interface TwitterMetadata {
    username: string;
    name?: string;
    type?: string;
    subject?: string;
    verifiedAt?: string;
    firstVerifiedAt?: string;
    latestVerifiedAt?: string;
    profilePictureUrl?: string;
}

export interface FarcasterMetadata {
    bio: string;
    username: string;
    displayName: string;
    fid: number;
    pfp: string;
    type: string;
    verifiedAt: string;
    ownerAddress: string;
    firstVerifiedAt: string;
    latestVerifiedAt: string;
}

export interface MoxieIdentity {
    id: string;
    userId: string;
    type: string;
    dataSource: string;
    connectedIdentitiesFetchStatus: string;
    metadata: TwitterMetadata | FarcasterMetadata;
    profileId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface MoxieWallet {
    id: string;
    userId: string;
    walletAddress: string;
    walletType: string;
    dataSource?: string;
    createdAt: string;
    deletedAt?: string;
}

export interface VestingContracts {
    beneficiaryAddress?: string;
    vestingContractAddress?: string;
}

export interface MoxieUser {
    id: string;
    userName?: string;
    name?: string;
    bio?: string;
    profileImageUrl?: string;
    referralCode: string;
    referrerId?: string;
    moxieScore?: number;
    moxieRank?: number;
    totalUsers?: number;
    primaryWalletId?: string;
    communicationPreference?: string;
    createdAt: string;
    identities: MoxieIdentity[];
    wallets: MoxieWallet[];
    vestingContracts: VestingContracts[];
}

export interface MoxieUserMinimal {
    id: string;
    userName?: string;
    name?: string;
    bio?: string;
    profileImageUrl?: string;
}

export interface MeQueryResponse {
    data: {
        Me: MoxieUser;
    };
    errors?: Array<{
        message: string;
        locations?: Array<{
            line: number;
            column: number;
        }>;
    }>;
}

export interface GetUserResponse {
    data: {
        GetUser: MoxieUser;
    };
}

export interface GetUserInfoBatchResponse {
    data: {
        GetUserInfoBatch: GetUserInfoBatchOutput;
    };
}

export interface GetUserInfoMinimalOutput {
    users: MoxieUserMinimal[];
}

export interface GetUserInfoMinimalResponse {
    data: {
        GetUserInfoMinimal: GetUserInfoMinimalOutput;
    };
}

export type GetWalletDetailsOutput = {
    success: boolean;
    privyId: string;
    wallet: undefined | PrivyWallet;
};

export interface SignMessageInput {
    message: string;
    address: string;
}

export interface SignMessageResponse {
    signature: string;
    encoding: string;
}

export type SignTransactionInput = {
    from?: string;
    to?: string;
    nonce?: number;
    chainId?: number;
    data?: string;
    value?: string;
    type?: number;
    gasLimit?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    address?: string;
};

export interface SignTransactionResponse {
    signature: string;
    encoding: string;
}

export type SignTypedDataInput = {
    domain: Record<string, any>;
    types: Record<string, any>;
    message: Record<string, any>;
    primaryType: string;
    address: string;
};

export interface SignTypedDataResponse {
    signature: string;
    encoding: string;
}

export interface SendTransactionResponse {
    hash: string;
    caip2?: string;
    code?: string;
    message?: string;
}

export interface SendTransactionInput extends SignTransactionInput {
    caip2?: string;
}

export interface TransactionDetails {
    fromAddress?: string;
    toAddress?: string;
    value?: number;
    data?: string;
    gasLimit?: number;
    gasPrice?: number;
    maxFeePerGas?: number;
    maxPriorityFeePerGas?: number;
}

export interface LiquidityPool {
    poolName?: string;
    poolAddress: string;
    liquidityUSD: number;
}

export interface TokenDetails {
    tokenName?: string;
    tokenSymbol?: string;
    tokenAddress?: string;
    networkId?: number;
    priceUSD?: string;
    liquidityTop3PoolsUSD?: string;
    fullyDilutedMarketCapUSD?: string;
    uniqueHolders?: number;
    uniqueBuysLast1Hour?: number;
    uniqueBuysLast4Hours?: number;
    uniqueBuysLast12Hours?: number;
    uniqueBuysLast24Hours?: number;
    uniqueSellsLast1Hour?: number;
    uniqueSellsLast4Hours?: number;
    uniqueSellsLast12Hours?: number;
    uniqueSellsLast24Hours?: number;
    changePercent1Hour?: string;
    changePercent4Hours?: string;
    changePercent12Hours?: string;
    changePercent24Hours?: string;
    high1Hour?: string;
    high4Hours?: string;
    high12Hours?: string;
    high24Hours?: string;
    low1Hour?: string;
    low4Hours?: string;
    low12Hours?: string;
    low24Hours?: string;
    volumeChange1Hour?: string;
    volumeChange4Hours?: string;
    volumeChange12Hours?: string;
    volumeChange24Hours?: string;
    liquidityPools?: LiquidityPool[];
}


export interface Skill {
    id: string;
    name: string;
    displayName: string;
    version: string;
    author: string;
    description: string;
    githubUrl: string;
    logoUrl: string;
    status: string;
    settings: any;
    capabilities: string[];
    starterQuestions: StarterQuestion[];
    mediaUrls: string[];
    actions: string[];
    isPremium: boolean;
    freeQueries: number;
    skillCoinAddress: string;
    minimumSkillBalance: number;
    installedStatus?: string;
    isDefault: boolean;
    isFeatured: boolean;
    loaders: string[];
}

export interface StarterQuestion {
    label: string;
    value: string;
}

export type GetUserInfoBatchOutput = {
    users: UserInfo[];
    freeTrialLimit: number;
    remainingFreeTrialCount: number;
};

export type UserInfo = {
    user: MoxieUser | null;
    errorDetails: ErrorDetails | null;
};

export type ErrorDetails = {
    errorMessage: string;
    expectedCreatorCoinBalance: number;
    actualCreatorCoinBalance: number;
    requesterId: string;
    requestedId: string;
    requestedUserName: string;
    requiredMoxieAmountInUSD: number;
};
export type EthereumSignMessageResponseType = {
    signature: string;
    encoding: string;
};

export type EthereumSignTypedDataResponseType = {
    signature: string;
    encoding: string;
};

export type EthereumSignTransactionResponseType = {
    signedTransaction: string;
    encoding: string;
};

export type EthereumSendTransactionResponseType = {
    hash: string;
    caip2: EvmCaip2ChainId;
};

export type EthereumSendTransactionInputType = EthereumRpcWrapper<
    EthereumBaseTransactionInputType & {
        /** CAIP-2 chain ID for the network to broadcast the transaction on. */
        caip2: EvmCaip2ChainId;
    }
>;

type EthereumRpcWrapper<T> = WithOptionalIdempotencyKey<
    WithWalletIdOrAddressChainType<T, "ethereum">
>;

type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};

type WithOptionalIdempotencyKey<T> = Prettify<
    T & {
        idempotencyKey?: string;
    }
>;

type WithWalletIdOrAddressChainType<T, U extends "solana" | "ethereum"> =
    | Prettify<
          T & {
              /** Address of the wallet. */
              address: string;
              /** Chain type of the wallet. */
              chainType: U;
          }
      >
    | Prettify<
          T & {
              /** ID of the wallet. */
              walletId: string;
          }
      >;

type EthereumBaseTransactionInputType = {
    transaction: {
        from?: Hex;
        to?: Hex;
        nonce?: Quantity;
        chainId?: Quantity;
        data?: Hex;
        value?: Quantity;
        gasLimit?: Quantity;
        gasPrice?: Quantity;
        maxFeePerGas?: Quantity;
        maxPriorityFeePerGas?: Quantity;
    };
};

export type EvmCaip2ChainId = `eip155:${string}`;
export type Quantity = Hex | number;
export type Hex = `0x${string}`;

export interface Wallet {
    address: string;
    chainType: "ethereum" | "solana";
    chainId?: string;
    walletType?: string;
    walletClientType?: string;
    connectorType?: string;
    hdWalletIndex?: number;
    imported?: boolean;
    delegated?: boolean;
}

export interface CampaignTokenDetails {
    tokenAddress: string;
    tokenSymbol: string;
    type: string;
    minimumBalance: number;
    startDate: Date;
    endDate: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface PublishPostInput {
    text: string;
    platform: string;
}

export interface PublishPostResponse {
    platform: string;
    post: {
        hash: string;
        text: string;
        username: string;
    };
}

export enum RuleType {
    COPY_TRADE = "COPY_TRADE",
    COPY_TRADE_AND_PROFIT = "COPY_TRADE_AND_PROFIT", 
    GROUP_COPY_TRADE = "GROUP_COPY_TRADE",
    GROUP_COPY_TRADE_AND_PROFIT = "GROUP_COPY_TRADE_AND_PROFIT",
    AGENT_SWAP = "AGENT_SWAP",
    WIDGET_SWAP = "WIDGET_SWAP",
    AGENT_SWAP_AND_LIMIT_ORDER = "AGENT_SWAP_AND_LIMIT_ORDER",
    AGENT_LIMIT_ORDER = "AGENT_LIMIT_ORDER",
    AGENT_STOP_LOSS = "AGENT_STOP_LOSS",
    AGENT_LIMIT_ORDER_STOP_LOSS = "AGENT_LIMIT_ORDER_STOP_LOSS"
}

export enum RuleStatus {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
    DELETED = "DELETED",
    CANCELLED = "CANCELLED",
    FAILED = "FAILED",
}

export enum RuleTrigger {
    USER = "USER",
    GROUP = "GROUP",
}

export enum BuyAmountValueType {
    USD = "USD",
    TOKEN = "TOKEN"
}

export enum SellAmountValueType {
    USD = "USD",
    TOKEN = "TOKEN"
}

export enum PurchaseAmountValueType {
    USD = "USD",
    TOKEN = "TOKEN"
}

export type SellTokenInput = {
    symbol: string;
    address: string;
}

export type BuyTokenInput = {
    symbol: string;
    address: string;
}

export type SellConfigInput = {
    // Add sell config properties as needed
}

export type TokenMetricsInput = {
    // Add token metrics properties as needed
}

export type BaseTradeRuleParamsInput = {
    buyAmount?: number;
    sellAmount?: number;
    duration?: number;
    buyAmountValueType?: BuyAmountValueType;
    sellAmountValueType?: SellAmountValueType;
    sellToken?: SellTokenInput;
    buyToken?: BuyTokenInput;
    sellConfig?: SellConfigInput;
    tokenMetrics?: TokenMetricsInput;
    transferTo?: string;
};


export type UserTradeRuleParamsInput = {
    moxieUsers: string[];
    minPurchaseAmount: {
        amount: number;
        valueType: PurchaseAmountValueType;
    }
}

export type GroupTradeRuleParamsInput = {
    // Add group trade params as needed
}

export type SellConditionInput = {
    priceChangePercentage: number;
    sellPercentage: number;
};

export type LimitOrderParamsInput = {
    sellConditions: SellConditionInput[];
    limitOrderValidityInSeconds?: number;
};


export type GenericTradeRuleParamsInput = {
    baseParams: BaseTradeRuleParamsInput;
    userTradeParams?: UserTradeRuleParamsInput;
    groupTradeParams?: GroupTradeRuleParamsInput;
    limitOrderParams?: LimitOrderParamsInput;
}

export type CreateRuleInput = {
    requestId: string;
    ruleType: RuleType;
    ruleTrigger: RuleTrigger;
    ruleParameters: GenericTradeRuleParamsInput;
}

export enum SwapSource {
    AGENT_SWAP = "AGENT_SWAP",
    WIDGET_SWAP = "WIDGET_SWAP",
    MANUAL_SWAP = "MANUAL_SWAP"
}

export interface AddRuleExecutionLogInput {
    ruleId: string;
    action: string;
    status: string;
    reason?: string;
    metadata?: any;
    inputParams?: any;
    source: SwapSource;
}