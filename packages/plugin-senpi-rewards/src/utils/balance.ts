import { createPublicClient } from "viem";
import { http } from "viem";
import { baseSepolia } from "viem/chains";

export const getRewardBalance = async (
    address: `0x${string}`
) => {
    try {
        const publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http(),
        });
        
        const balance = await publicClient.readContract({
            address: "0x4a7f3C6E390A24d655cb72a3DAafEba0cd3327a9" as `0x${string}`,
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
        console.error(error);
        return null;
    }
};
