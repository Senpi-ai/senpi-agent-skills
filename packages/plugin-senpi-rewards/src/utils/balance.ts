import { createPublicClient } from "viem";
import { http } from "viem";
import { base } from "viem/chains";
import { elizaLogger } from "@moxie-protocol/core";
import { ethers } from "ethers";
import retry from "async-retry";

export const getRewardBalance = async (
    address: `0x${string}`
) => {
    try {
        const publicClient = createPublicClient({
            chain: base,
            transport: http(),
        });

        let retries = 3;
        let delay = 1000;
        
        while (retries > 0) {
            try {
                const balance = await publicClient.readContract({
                    address: process.env.SENPI_REWARDS_CONTRACT_ADDRESS as `0x${string}`,
                    abi: [
                        {
                            name: "balanceOf",
                            type: "function",
                            inputs: [{ type: "address", name: "account" }],
                            outputs: [{ type: "uint256", name: "balance" }],
                        },
                    ],
                    functionName: "balanceOf",
                    args: [address],
                });
                return balance;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
        
                // Wait with exponential backoff before retrying
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2; // Double the delay for next retry
            }
        }
    } catch (error) {
        console.error(error);
        return null;
    }
};


export async function getNativeTokenBalance(walletAddress: string): Promise<bigint> {
    try {
        // Using Base mainnet RPC URL
        const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);

        const result = await retry(async (_, attempt) => {
            try {
                elizaLogger.debug(`[getNativeTokenBalance] Attempt ${attempt} of 3`);
                const balanceWEI = await provider.getBalance(walletAddress);
                elizaLogger.debug(`[getNativeTokenBalance] Balance of ${walletAddress} is ${balanceWEI.toString()}`);
                return balanceWEI;
            } catch (error) {
                elizaLogger.error(`[getNativeTokenBalance] Error: ${error}`);
                throw error;
            }}, {
                retries: 3,
                factor: 2,
            }
        );
        return result;
    } catch (error) {
        elizaLogger.error('Error fetching native token balance:', error);
        throw error;
    }
}