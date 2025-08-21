import { elizaLogger, IAgentRuntime } from "@moxie-protocol/core";

export interface Portfolio {
    totalBalanceUSD: number;
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
}

interface TokenBalance {
    address: string;
    network: string;
    token: Token;
}

/**
 * @param addresses - The addresses of the wallets to get the portfolio for
 * @param networks - The networks of the wallets to get the portfolio for
 * @param tokenAddresses - If added, will just return the portfolio for the given token addresses
 * @returns The portfolio for the given addresses and networks
 */
export async function getPortfolio(
    addresses: string[],
    networks: number[],
    tokenAddresses?: string[]
): Promise<Portfolio> {
    try {
        const query = /* GraphQL */ `
            query GetPortfolio($input: GetPortfolioInput!) {
                GetPortfolio(input: $input) {
                    totalBalanceUSD
                    tokenBalances {
                        tokenAddress
                        tokenSymbol
                        tokenPriceInUSD
                        formattedBalance
                        balanceInWei
                        balanceInUSD
                        decimals
                        tokenImgUrl
                        tokenName
                        chainId
                        onchainMarketData {
                            priceChange24h
                        }
                        tokenOwner
                    }
                    totalCount
                }
            }
        `;

        const response = await fetch(
            process.env.MOXIE_API_URL_INTERNAL as string,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    query,
                    variables: {
                        input: {
                            addresses,
                            networks,
                            ...(tokenAddresses && tokenAddresses?.length > 0
                                ? { tokenAddresses }
                                : {}),
                        },
                    },
                }),
            }
        );

        if (!response.ok) {
            elizaLogger.error(
                "Failed to fetch portfolio",
                response.statusText,
                response.status
            );
            throw new Error(
                `Failed to fetch portfolio: ${response.statusText} ${response.status}`
            );
        }

        const { data, errors } = await response.json();

        if (errors) {
            elizaLogger.error("Failed to fetch portfolio", errors);
            throw new Error(
                `Failed to fetch portfolio: ${errors.map((e: any) => e?.message).join(", ")}`
            );
        }

        const portfolio = data.GetPortfolio;

        return {
            totalBalanceUSD: portfolio.totalBalanceUSD,
            tokenBalances: portfolio.tokenBalances.map((token: any) => ({
                address: token.tokenAddress,
                network: token.chainId,
                token: {
                    balance: token.formattedBalance,
                    balanceUSD: token.balanceInUSD,
                    balanceRaw: token.balanceInWei,
                    baseToken: {
                        name: token.tokenName,
                        symbol: token.tokenSymbol,
                        address: token.tokenAddress,
                        decimals: token.decimals,
                    },
                },
            })),
        };
    } catch (e) {
        elizaLogger.error("Failed to fetch portfolio", e);
        throw new Error(
            `Failed to fetch portfolio: ${e instanceof Error ? e.message : "Unknown error"}`
        );
    }
}
