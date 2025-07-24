import { elizaLogger } from "@moxie-protocol/core";
import { ethers } from "ethers";
import { CreateManualOrderInput, ActionType, CreateManualOrderOutput, OpenOrderInput, Source, SwapInput } from "../types";
import { gql } from "graphql-request";

/**
 * Converts a given Ethereum address to a padded format.
 * @param fromAddress - The original Ethereum address to convert.
 * @returns The converted Ethereum address in a padded format.
 */
export function convertAddress(fromAddress: string): string {
    const strippedAddress = fromAddress.substring(2); // Remove '0x'
    const paddedAddress = '000000000000000000000000' + strippedAddress;
    const convertedAddress = '0x' + paddedAddress;
    return convertedAddress;
}

/**
 * Extracts token details from a given token string.
 * @param token - The token string to extract details from.
 * @returns An object containing the token symbol and token address, or null if not found.
 */
export function extractTokenDetails(token: string): { tokenSymbol: string | null; tokenAddress: string | null } {
    const regexWithSymbol = /\$\[([^|]+)\|([^\]]+)\]/;
    const matchWithSymbol = token.match(regexWithSymbol);

    if (matchWithSymbol) {
        return {
            tokenSymbol: matchWithSymbol[1],
            tokenAddress: matchWithSymbol[2]
        };
    }

    const regexAddressOnly = /^0x[a-fA-F0-9]{40}$/;
    if (regexAddressOnly.test(token)) {
        return {
            tokenSymbol: null,
            tokenAddress: token
        };
    }

    return {
        tokenSymbol: null,
        tokenAddress: null
    };
}

/**
 * Checks if a given token symbol represents a stable coin.
 * @param tokenSymbol - The symbol of the token to check.
 * @returns True if the token is a stable coin, false otherwise.
 */
export const isStableCoin = (tokenSymbol: string) => {
    // Map of stable coins by symbol
    const stableCoins = (process.env.STABLE_COINS || 'USDC,USDT,DAI,ETH,WETH').split(',').map(coin => coin.trim());
    return stableCoins.includes(tokenSymbol.toUpperCase());
}

/**
 * Fetches the ERC20 token balance for a given wallet address.
 * @param traceId - The trace ID for logging purposes.
 * @param tokenAddress - The address of the ERC20 token.
 * @param walletAddress - The wallet address to fetch the balance for.
 * @returns The balance of the ERC20 token in WEI as a string.
 * @throws Error if the balance cannot be fetched.
 */
export async function getERC20Balance(traceId: string, tokenAddress: string, walletAddress: string): Promise<string> {
    const abi = [
        {
            "constant": true,
            "inputs": [{ "name": "_owner", "type": "address" }],
            "name": "balanceOf",
            "outputs": [{ "name": "balance", "type": "uint256" }],
            "type": "function"
        }
    ];

    try {
        // Using Base mainnet RPC URL
        const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
        const checksumAddress = ethers.getAddress(walletAddress);
        const contract = new ethers.Contract(tokenAddress, abi, provider);

        let retries = 3;
        let delay = 1000; // Start with 1 second delay

        while (retries > 0) {
            try {
                const balanceWEI = await contract.balanceOf(checksumAddress);
                elizaLogger.debug(traceId,`[getERC20Balance] [${tokenAddress}] [${walletAddress}] fetched balance: ${balanceWEI.toString()}`);
                return balanceWEI.toString();
            } catch (error) {
                retries--;
                if (retries === 0) throw error;

                // Wait with exponential backoff before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Double the delay for next retry
            }
        }
    } catch (error) {
        elizaLogger.error(traceId,`[getERC20Balance] [${tokenAddress}] [${walletAddress}] Error fetching token balance: ${JSON.stringify(error)}`);
        throw error;
    }
}

/**
 * Fetches the native token balance for a given wallet address.
 * @param traceId - The trace ID for logging purposes.
 * @param walletAddress - The wallet address to fetch the balance for.
 * @returns The balance of the native token in WEI as a string.
 * @throws Error if the balance cannot be fetched.
 */
export async function getNativeTokenBalance(traceId: string, walletAddress: string) {
    try {
        // Using Base mainnet RPC URL
        const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
        const checksumAddress = ethers.getAddress(walletAddress);

        // Add retry logic with exponential backoff
        let retries = 3;
        let delay = 1000; // Start with 1 second delay

        while (retries > 0) {
            try {
                const balanceWEI = await provider.getBalance(checksumAddress);
                elizaLogger.debug(traceId,`[getNativeTokenBalance] [${walletAddress}] fetched balance: ${balanceWEI.toString()}`);
                return balanceWEI.toString();
            } catch (error) {
                retries--;
                if (retries === 0) throw error;

                // Wait with exponential backoff before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Double the delay for next retry
            }
        }
    } catch (error) {
        elizaLogger.error(traceId,`[getNativeTokenBalance] [${walletAddress}] Error fetching native token balance: ${JSON.stringify(error)}`);
        throw error;
    }
}

/**
 * Fetches the number of decimals for an ERC20 token.
 * @param traceId - The trace ID for logging purposes.
 * @param tokenAddress - The address of the ERC20 token.
 * @returns The number of decimals for the token.
 * @throws Error if the token address is invalid or the decimals cannot be fetched.
 */
export async function getERC20Decimals(traceId: string, tokenAddress: string) {
    const abi = [
        {
            "constant": true,
            "inputs": [],
            "name": "decimals",
            "outputs": [{ "name": "decimals", "type": "uint8" }],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        }
    ];
    try {
        // Verify checksum address
        const checksumAddress = ethers.getAddress(tokenAddress);
        const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
        const contract = new ethers.Contract(checksumAddress, abi, provider);

        // Add retry logic with exponential backoff
        let retries = 3;
        let delay = 1000; // Start with 1 second delay

        while (retries > 0) {
            try {
                const decimals = await contract.decimals();
                elizaLogger.debug(traceId,`[getERC20Decimals] [${tokenAddress}] fetched decimals: ${decimals}`);
                return decimals;
            } catch (err) {
                retries--;
                if (retries === 0) throw err;

                // Wait with exponential backoff before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Double the delay for next retry
            }
        }
    } catch (error) {
        elizaLogger.error(traceId,`[getERC20Decimals] [${tokenAddress}] Error fetching token decimals: ${JSON.stringify(error)}`);
        throw error;
    }
}

/**
 * GraphQL mutation for creating a manual order.
 */
const mutation = gql`
    mutation CreateManualOrder($createRuleInput: CreateManualOrderInput!) {
        CreateManualOrder(input: $createRuleInput) {
            success
            error
            metadata {
                traceId
                orderId
                ruleId
                ruleExecutionLogId
                swapOutput {
                    txHash
                    buyAmount
                    sellAmount
                    buyAmountInUSD
                    sellAmountInUSD
                    buyPrice
                }
                stopLossOutputs {
                    subscriptionId
                    stopLossPrice
                    sellAmount
                    triggerType
                    triggerValue
                }
                limitOrderOutputs {
                    limitOrderId
                    limitPrice
                    buyAmount
                    sellAmount
                    triggerType
                    triggerValue
                }
            }
        }
    }
`;

/**
 * Creates a manual order by sending a GraphQL mutation request.
 *
 * @param authorizationHeader - The authorization token for the request.
 * @param actionType - The type of action to be performed.
 * @param source - The source of the order.
 * @param swapInput - The input details for a swap order.
 * @param stopLossInput - The input details for stop loss orders.
 * @param limitOrderInput - The input details for limit orders.
 * @returns A promise that resolves to the result of the CreateManualOrder mutation.
 * @throws Error if the request fails or if the response contains errors.
 */
export async function createManualOrder(
    authorizationHeader: string,
    actionType: ActionType,
    source: Source,
    swapInput: SwapInput | undefined,
    stopLossInput: OpenOrderInput[] | undefined,
    limitOrderInput: OpenOrderInput[] | undefined
): Promise<CreateManualOrderOutput> {
    // Validate input: Ensure at least one of the inputs is provided

    elizaLogger.debug(`[CREATE_MANUAL_ORDER] [${source}] [${actionType}] [${JSON.stringify(swapInput)}] [${JSON.stringify(stopLossInput)}] [${JSON.stringify(limitOrderInput)}]`);
    if (!stopLossInput && !limitOrderInput && !swapInput) {
        throw new Error(
            "Please provide either stopLossInput or limitOrderInput or swapInput."
        );
    }

    const createRuleInput: CreateManualOrderInput = {
        actionType,
        source,
        swapInput,
        stopLossInput,
        limitOrderInput,
    };

    try {
        const response = await fetch(process.env.MOXIE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authorizationHeader,
            },
            body: JSON.stringify({
                query: mutation,
                variables: { createRuleInput },
            }),
        });

        const result = await response.json();

        elizaLogger.info(
            `[CREATE_MANUAL_ORDER] CreateManualOrder result: ${JSON.stringify(result)}`
        );

        if (result.errors) {
            throw new Error(
                `Failed to create manual order: ${result.errors[0].message}`
            );
        }

        return result.data.CreateManualOrder as CreateManualOrderOutput;
    } catch (error) {
        elizaLogger.error(`CreateManualOrder failed: ${error}`);
        throw new Error(`Error creating manual order: ${error.message}`);
    }
}

