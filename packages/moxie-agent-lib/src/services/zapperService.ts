import axios from "axios";
import { elizaLogger, IAgentRuntime } from "@moxie-protocol/core";
import { mockPortfolio, mockPortfolioV2 } from "./constants";
const CACHE_EXPIRATION = 60000; // 1 minute in milliseconds

interface PortfolioResponse {
    data: {
        data: {
            portfolio: Portfolio;
        };
    };
}

export interface Portfolio {
    tokenBalances: TokenBalance[];
}

interface BaseToken {
    name: string;
    symbol: string;
    address: string;
    decimals: number;
}

interface Token {
    balance: number;
    balanceUSD: number;
    balanceRaw: string;
    baseToken: BaseToken;
    holdingPercentage?: number;
}

interface TokenBalance {
    address: string;
    network: string;
    token: Token;
}

interface DisplayProps {
    label: string;
}

interface AppTokenPosition {
    type: "app-token";
    address: string;
    network: string;
    appId: string;
    groupId: string;
    balance: string;
    balanceUSD: number;
    price: number;
    symbol: string;
    decimals: number;
    displayProps?: DisplayProps;
}

interface ContractPosition {
    type: "contract-position";
    address: string;
    network: string;
    appId: string;
    groupId: string;
    balance?: string;
    balanceUSD?: number;
    displayProps?: DisplayProps;
}

interface Product {
    label: string;
    assets: (AppTokenPosition | ContractPosition)[];
    meta: any[];
}

interface AppBalance {
    address: string;
    appId: string;
    network: string;
    balanceUSD: number;
    products: Product[];
}

export interface TokenNode {
    id: string;
    tokenAddress: string;
    name: string;
    symbol: string;
    decimals: number;
    price: number;
    balance: number;
    balanceUSD: number;
    balanceRaw: string;
    holdingPercentage: number;
    imgUrl: string;
    accountBalances?: {
        edges: {
            node: {
                accountAddress: string;
            };
        }[];
    };
}
export interface PortfolioV2Data {
    tokenBalances: {
        totalBalanceUSD: number;
        byToken: {
            edges: Array<{
                cursor: string;
                node: TokenNode;
            }>;
        };
    };
    metadata: {
        addresses: string[];
        networks: string[];
    };
}
export interface PortfolioV2Response {
    portfolioV2: PortfolioV2Data;
}

const API_KEY = process.env.ZAPPER_API_KEY;
const encodedKey = btoa(API_KEY);

const client = axios.create({
    baseURL: process.env.ZAPPER_API_URL,
    headers: {
        authorization: `Basic ${encodedKey}`,
        "Content-Type": "application/json",
    },
});

/**
 * Fetches portfolio V2 data for the given addresses and networks.
 * If `topTokens` is provided, only fetches the top N tokens (no pagination).
 * Otherwise, paginates through all tokens as before.
 * @param addresses
 * @param networks
 * @param userId
 * @param runtime
 * @param topTokens (optional) - number of top tokens to fetch (no pagination if provided)
 */
export async function getPortfolioV2Data(
    addresses: string[],
    networks: string[],
    userId: string,
    runtime: IAgentRuntime,
    topTokens?: number
): Promise<PortfolioV2Data> {
    if (!API_KEY) return mockPortfolioV2;

    const cacheKey = topTokens
        ? `PORTFOLIO-V2-${userId}-TOP-${topTokens}`
        : `PORTFOLIO-V2-${userId}`;
    const cached = await runtime.cacheManager.get(cacheKey);
    if (cached) return JSON.parse(cached as string);

    // Helper for retrying API calls
    async function fetchWithRetry(query: string, variables: any) {
        let attempts = 0, max = 3, backoff = 1000;
        while (attempts < max) {
            try {
                const res = await client.post("", { query, variables });
                if (res.status !== 200) throw new Error(`HTTP error! status: ${res.status}`);
                return res.data.data.portfolioV2;
            } catch (e) {
                attempts++;
                if (attempts === max) throw e;
                elizaLogger.warn(`Zapper API call failed, attempt ${attempts}/${max}. Retrying...`);
                await new Promise(r => setTimeout(r, backoff * attempts));
            }
        }
    }

    try {
        if (topTokens && topTokens > 0) {
            const query = `
                query PortfolioV2($addresses: [Address!]!, $networks: [Network!]!) {
                    portfolioV2(addresses: $addresses, networks: $networks) {
                        tokenBalances {
                            totalBalanceUSD
                            byToken(first: ${topTokens}) {
                                edges {
                                    node {
                                        tokenAddress name symbol decimals price balance balanceUSD balanceRaw
                                        accountBalances { edges { node { accountAddress } } }
                                    }
                                    cursor
                                }
                            }
                        }
                        metadata { addresses networks }
                    }
                }
            `;
            const data = await fetchWithRetry(query, { addresses, networks });
            const edges = data.tokenBalances.byToken.edges;
            const totalBalanceUSD = edges.reduce((t: number, e: { node: TokenNode }) => t + e.node.balanceUSD, 0);
            const result: PortfolioV2Data = {
                tokenBalances: { totalBalanceUSD, byToken: { edges } },
                metadata: { addresses, networks }
            };
            await runtime.cacheManager.set(cacheKey, JSON.stringify(result), { expires: Date.now() + CACHE_EXPIRATION });
            return result;
        }

        // Pagination branch
        const query = `
            query PortfolioV2($addresses: [Address!]!, $networks: [Network!]!, $after: String) {
                portfolioV2(addresses: $addresses, networks: $networks) {
                    tokenBalances {
                        totalBalanceUSD
                        byToken(first: 100, after: $after) {
                            edges {
                                node {
                                    tokenAddress name symbol decimals price balance balanceUSD balanceRaw
                                    accountBalances { edges { node { accountAddress } } }
                                }
                                cursor
                            }
                        }
                    }
                    metadata { addresses networks }
                }
            }
        `;
        let allEdges: Array<{ cursor: string; node: TokenNode }> = [], after: string | null = null;
        while (true) {
            const data = await fetchWithRetry(query, { addresses, networks, after });
            const edges = data.tokenBalances.byToken.edges;
            allEdges = allEdges.concat(edges);
            if (!edges.length || edges.length < 100) break;
            after = edges[edges.length - 1].cursor;
        }
        const totalBalanceUSD = allEdges.reduce((t, e) => t + e.node.balanceUSD, 0);
        const result: PortfolioV2Data = {
            tokenBalances: { totalBalanceUSD, byToken: { edges: allEdges } },
            metadata: { addresses, networks }
        };
        await runtime.cacheManager.set(cacheKey, JSON.stringify(result), { expires: Date.now() + CACHE_EXPIRATION });
        return result;
    } catch (error) {
        elizaLogger.error("Error fetching portfolioV2 data:", error);
        throw error;
    }
}

export async function getPortfolioV2DataByTokenAddress(
    traceId: string,
    addresses: string[],
    networks: string[],
    tokenAddress: string,
    moxieUserId: string
): Promise<PortfolioV2Data> {
    elizaLogger.info(
        `[getPortfolioV2DataByTokenAddress] [${traceId}] [${moxieUserId}] Getting portfolioV2 data by token address: ${tokenAddress}`
    );
    try {
        const query = `
            query PortfolioV2 ($addresses: [Address!]!, $networks: [Network!]!, $tokenAddress: String!) {
                portfolioV2 (addresses: $addresses, networks: $networks) {
                    metadata {
                        addresses
                        networks
                    }
                    tokenBalances {
                        byToken(filters: { tokenAddress: $tokenAddress }) {
                            edges {
                                cursor
                                node {
                                    tokenAddress
                                    name
                                    symbol
                                    balance
                                    balanceUSD
                                    imgUrl
                                }
                            }
                        }
                    }
                }
            }
        `;

        let attempts = 0;
        const maxAttempts = 3;
        const backoffMs = 1000;

        while (attempts < maxAttempts) {
            try {
                const response = await client.post("", {
                    query: query,
                    variables: {
                        addresses,
                        networks,
                        tokenAddress: tokenAddress
                            ? tokenAddress.toLowerCase()
                            : "",
                    },
                });

                if (response.status !== 200) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const portfolioData = response.data.data.portfolioV2;
                return portfolioData;
            } catch (error) {
                attempts++;
                if (attempts === maxAttempts) {
                    throw error;
                }
                elizaLogger.warn(
                    ` [getPortfolioV2DataByTokenAddress] [${traceId}] [${moxieUserId}] Zapper getPortfolioV2DataByTokenAddress failed, attempt ${attempts}/${maxAttempts}. Retrying...`
                );
                await new Promise((resolve) =>
                    setTimeout(resolve, backoffMs * attempts)
                );
            }
        }
    } catch (error) {
        elizaLogger.error(
            ` [getPortfolioV2DataByTokenAddress] [${traceId}] [${moxieUserId}] Error fetching Zapper getPortfolioV2DataByTokenAddress data:`,
            error
        );
        throw error;
    }
}

export interface ZapperTokenDetails {
    name: string;
    address: string;
    symbol: string;
}

export async function getTokenMetadata(
    tokenAddress: string,
    runtime: IAgentRuntime
): Promise<ZapperTokenDetails> {
    try {
        const cacheKey = `TOKEN-METADATA-${tokenAddress}`;
        const cachedTokenMetadata = await runtime.cacheManager.get(cacheKey);

        if (cachedTokenMetadata) {
            return JSON.parse(cachedTokenMetadata as string);
        }

        const query = `
        query GetTokenDetails($address: Address!) {
            fungibleToken(address: $address, network: BASE_MAINNET) {
                name
                address
                symbol
            }
        }
        `;

        let attempts = 0;
        const maxAttempts = 3;
        const backoffMs = 1000;

        while (attempts < maxAttempts) {
            try {
                const response = await client.post("", {
                    query: query,
                    variables: {
                        address: tokenAddress,
                    },
                });

                if (response.status !== 200) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                let fungibleToken = response.data.data.fungibleToken;
                await runtime.cacheManager.set(
                    cacheKey,
                    JSON.stringify(fungibleToken),
                    {}
                );

                return fungibleToken;
            } catch (error) {
                attempts++;
                if (attempts === maxAttempts) {
                    throw error;
                }
                elizaLogger.warn(
                    ` [getTokenMetadata] [${tokenAddress}] Zapper getTokenMetadata failed, attempt ${attempts}/${maxAttempts}. Retrying...`
                );
                await new Promise((resolve) =>
                    setTimeout(resolve, backoffMs * attempts)
                );
            }
        }
    } catch (error) {
        elizaLogger.error(
            ` [getTokenMetadata] [${tokenAddress}] Error fetching Zapper getTokenMetadata data:`,
            error
        );
        throw error;
    }
}
