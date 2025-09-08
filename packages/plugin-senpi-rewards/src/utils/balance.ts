import { createPublicClient } from "viem";
import { http } from "viem";
import { baseSepolia } from "viem/chains";



// let retries = 3;
// let delay = 1000; // Start with 1 second delay

// while (retries > 0) {
//     try {
//         const balanceWEI = await contract.balanceOf(checksumAddress);
//         elizaLogger.debug(
//             traceId,
//             `[getERC20Balance] [${tokenAddress}] [${walletAddress}] fetched balance: ${balanceWEI.toString()}`
//         );
//         return balanceWEI.toString();
//     } catch (error) {
//         retries--;
//         if (retries === 0) throw error;

//         // Wait with exponential backoff before retrying
//         await new Promise((resolve) => setTimeout(resolve, delay));
//         delay *= 2; // Double the delay for next retry
//     }
// }
export const getRewardBalance = async (
    address: `0x${string}`
) => {
    try {
        const publicClient = createPublicClient({
            chain: baseSepolia,
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
