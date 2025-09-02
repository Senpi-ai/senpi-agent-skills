import request, { gql } from "graphql-request";

export const getTokenBalance = async (
    address: `0x${string}`,
    first: number = 100
) => {
    try {
        const query = gql`
            query TokenBalances($addresses: [Address!]!, $first: Int) {
                portfolioV2(addresses: $addresses) {
                    tokenBalances {
                        totalBalanceUSD
                        byToken(first: $first) {
                            totalCount
                            edges {
                                node {
                                    symbol
                                    tokenAddress
                                    balance
                                    balanceUSD
                                    price
                                    imgUrlV2
                                    name
                                    network {
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;
        const data = await request({
            url: "https://public.zapper.xyz/graphql",
            document: query,
            variables: {
                addresses: [address],
                first,
            },
            requestHeaders: {
                "Content-Type": "application/json",
                Authorization: `Basic ${btoa(process.env.ZAPPER_API_KEY)}`,
            },
        });
        return (data as any)?.portfolioV2?.tokenBalances;
    } catch (error) {
        console.error(error);
        return null;
    }
};
