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

import { getNativeTokenBalance, getRewardBalance } from "../utils/balance";
import { ethers } from "ethers";

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
            elizaLogger.log("Starting CLAIM_REWARDS handler... Trace ID: " + message.id);

            const { address } = state.agentWallet as MoxieWalletClient;
            const traceId = message.id;

            const balance = await getRewardBalance(address as `0x${string}`);

            if (!balance || balance === 0) {
                await callback?.({
                    text: `🥷 Check back every Tuesday to claim your rewards! Earn more rewards by inviting friends and creating top performing groups. ⚡️`,
                    action: "CLAIM_REWARDS",
                });
                return;
            }

            // get eth balance of the wallet
            const ethBalance = await getNativeTokenBalance(address as `0x${string}`);
            if (!ethBalance) {
                await callback?.({
                    text: `⚠️ Failed to claim rewards - please fund your wallet with Base ETH and try again.`,
                    action: "CLAIM_REWARDS",
                });
                return;
            }


            elizaLogger.log(`Reward Balance of ${address} is ${balance}. Trace ID: ${traceId}`);

            const balanceAsEther = ethers.formatEther(balance as bigint);

            await callback?.({
                text: `✨ Preparing rewards payout of ${balanceAsEther} ETH\n\n`,
                content: {
                    action: "CLAIM_REWARDS",
                    inReplyTo: traceId,
                },
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

            elizaLogger.log(`Redeeming rewards of ${balanceAsEther} ETH to ${address}. Trace ID: ${traceId}`);
    
            const { hash } = await wallet.sendTransaction("8453", {
                fromAddress: address as `0x${string}`,
                toAddress: process.env.SENPI_REWARDS_CONTRACT_ADDRESS as `0x${string}`,
                value: null,
                data: data,
            });

            elizaLogger.success(
                `Confirmed: paid out ${balanceAsEther} ETH! Transaction hash: ${hash}`
            );
            await callback?.(
                {
                    text: `✅ **Rewards claim completed!** \n\n View tx: [BaseScan](https://basescan.org/tx/${hash})\n\n 💡 Don’t forget to visit the Rewards section and share your referral code with friends — the more they join Senpi, the more rewards you earn! 🚀`,
                    content: {
                        action: "CLAIM_REWARDS",
                        inReplyTo: traceId,
                    },
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
