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

export async function getPortfolioV2Data(
    addresses: string[],
    networks: string[],
    userId: string,
    runtime: IAgentRuntime
): Promise<PortfolioV2Data> {
    if (!API_KEY) {
        return mockPortfolioV2;
    } else {
        try {
            const cacheKey = `PORTFOLIO-V2-${userId}`;
            const cachedPortfolio = await runtime.cacheManager.get(cacheKey);

            if (cachedPortfolio) {
                return JSON.parse(cachedPortfolio as string);
            }

            const query = /* GraphQL */ `
                query PortfolioV2(
                    $addresses: [Address!]!
                    $networks: [Network!]!
                    $after: String
                ) {
                    portfolioV2(addresses: $addresses, networks: $networks) {
                        tokenBalances {
                            totalBalanceUSD
                            byToken(
                                filters: { minBalanceUSD: 0.01 }
                                first: 100
                                after: $after
                            ) {
                                edges {
                                    node {
                                        tokenAddress
                                        name
                                        symbol
                                        price
                                        balance
                                        balanceUSD
                                        accountBalances {
                                            edges {
                                                node {
                                                    accountAddress
                                                }
                                            }
                                        }
                                    }
                                    cursor
                                }
                            }
                        }
                        metadata {
                            addresses
                            networks
                        }
                    }
                }
            `;

            let allEdges: Array<{ cursor: string; node: TokenNode }> = [];
            let after: string | null = null;
            let hasNextPage = true;

            while (hasNextPage) {
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
                                after,
                            },
                        });

                        if (response.status !== 200) {
                            throw new Error(
                                `HTTP error! status: ${response.status}`
                            );
                        }

                        const portfolioData = response.data.data.portfolioV2;
                        const edges = portfolioData.tokenBalances.byToken.edges;

                        // Add edges from this page to our collection
                        allEdges = allEdges.concat(edges);

                        // Check if there are more pages
                        if (edges.length === 0 || edges.length < 100) {
                            hasNextPage = false;
                        } else {
                            // Get the cursor from the last edge for the next page
                            after = edges[edges.length - 1].cursor;
                        }

                        break; // Success, exit retry loop
                    } catch (error) {
                        attempts++;
                        if (attempts === maxAttempts) {
                            throw error;
                        }
                        elizaLogger.warn(
                            `Airstack API call failed, attempt ${attempts}/${maxAttempts}. Retrying...`
                        );
                        await new Promise((resolve) =>
                            setTimeout(resolve, backoffMs * attempts)
                        );
                    }
                }
            }

            // Construct the final response with all edges
            const finalPortfolioData: PortfolioV2Data = {
                tokenBalances: {
                    totalBalanceUSD: 0, // This will be calculated from all edges
                    byToken: {
                        edges: allEdges,
                    },
                },
                metadata: {
                    addresses,
                    networks,
                },
            };

            // Calculate total balance from all edges
            finalPortfolioData.tokenBalances.totalBalanceUSD = allEdges.reduce(
                (total, edge) => total + edge.node.balanceUSD,
                0
            );

            await runtime.cacheManager.set(
                cacheKey,
                JSON.stringify(finalPortfolioData),
                {
                    expires: Date.now() + CACHE_EXPIRATION,
                }
            );

            return finalPortfolioData;
        } catch (error) {
            elizaLogger.error("Error fetching portfolioV2 data:", error);
            throw error;
        }
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
                                    decimals
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
