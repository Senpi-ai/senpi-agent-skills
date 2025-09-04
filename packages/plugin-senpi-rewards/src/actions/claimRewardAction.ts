import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    elizaLogger,
    type ActionExample,
} from "@moxie-protocol/core";
import { MoxieWalletClient } from "@moxie-protocol/moxie-agent-lib/src/wallet";
import { encodeFunctionData} from "viem";

import { getRewardBalance } from "../utils/balance";

export const claimRewardsAction: Action = {
    name: "CLAIM_REWARDS",
    similes: [
        "CLAIM_REWARDS",
        "CLAIM_REWARDS_ON_SENPI",
        "SEND_REWARDS_TO_SENPI_WALLET",
    ],
    description: "Send, payout or claim your earned rewards from Senpi to your wallet",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        try {
            elizaLogger.log("Starting CLAIM_REWARDS handler...");

            const { address } = state.agentWallet as MoxieWalletClient;

            const balance = await getRewardBalance(address as `0x${string}`);

            if (!balance || balance === 0) {
                await callback?.({
                    text: "You have no rewards to claim.",
                    action: "CLAIM_REWARDS",
                });
                return;
            }


            console.log("---- balance", balance);

            await callback?.({
                text: `Preparing rewards payout of ${balance} ETH`,
                action: "CLAIM_REWARDS",
            });

            const data = encodeFunctionData({
                abi:[{
                    inputs: [
                      {
                        "internalType": "address",
                        "name": "to",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "amount",
                        "type": "uint256"
                      }
                    ],
                    name: "withdraw",
                    outputs: [],
                    stateMutability: "nonpayable",
                    type: "function"
                  }],
                functionName: "withdraw",
                args: [address as `0x${string}`, balance as bigint],
            });
            const wallet = state.moxieWalletClient as MoxieWalletClient;

            await callback?.({
                text: `Sending ETH to your Senpi wallet`,
                action: "CLAIM_REWARDS",
            });
    
            const { hash } = await wallet.sendTransaction("85432", {
                toAddress: "0x4a7f3C6E390A24d655cb72a3DAafEba0cd3327a9",
                value: null,
                data: data,
            });

            elizaLogger.success(
                `Confirmed: paid out ${balance} ETH! Transaction hash: ${hash}`
            );
            await callback?.(
                {
                    text: `Confirmed: paid out ${balance} ETH! Transaction hash: ${hash}`,
                    action: "CLAIM_REWARDS",
                },
                []
            );
            return true;


        } catch (error) {
            elizaLogger.error("Error transfering Base ETH:", error);
            callback({
                text: "Failed to transfer Base ETH. Please check the logs.",
            });
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Pay out my rewards balance",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Confirmed: paid out 0.24 ETH",
                    action: "CLAIM_REWARDS",
                },
            },
        ],
    ] as ActionExample[][],
};
