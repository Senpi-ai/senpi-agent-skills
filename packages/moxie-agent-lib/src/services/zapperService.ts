import axios from "axios";
import { elizaLogger, IAgentRuntime } from "@moxie-protocol/core";

const API_KEY = process.env.ZAPPER_API_KEY;
const encodedKey = btoa(API_KEY);

const client = axios.create({
    baseURL: process.env.ZAPPER_API_URL,
    headers: {
        authorization: `Basic ${encodedKey}`,
        "Content-Type": "application/json",
    },
});

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
