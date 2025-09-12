import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    type ActionExample,
    elizaLogger,
} from "@moxie-protocol/core";
import { MoxieWalletClient } from "@moxie-protocol/moxie-agent-lib/src/wallet";
import { formatEther } from "viem";
import { getPrice } from "../utils/codexApis";
import { ETH, ETH_ADDRESS, ETH_TOKEN_DECIMALS, USDC, USDC_ADDRESS, USDC_TOKEN_DECIMALS } from "../utils/constants";
import { ethers } from "ethers";
import { getRewardBalance } from "../utils/balance";

export const checkRewardsAction: Action = {
    name: "CHECK_REWARDS",
    similes: [
        "CHECK_REWARDS",
        "VIEW_REWARDS",
        "SHOW_REWARDS",
        "WALLET_REWARDS",
        "ETH_REWARDS",
        "BASE_REWARDS",
    ],
    description: "Check the rewards of your agent wallet on Senpi",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
  
        const { address } = state.agentWallet as MoxieWalletClient;

        elizaLogger.info(`[checkRewardsAction] Checking rewards for address ${address}. traceId: ${message.id}`);

        const balance = await getRewardBalance(address as `0x${string}`);
   
        if (!balance || balance === 0) {
            await callback?.({
                text: `🥷 Check back every Tuesday to claim your rewards! Earn more rewards by inviting friends and creating top performing groups. ⚡️`,
                action: "CHECK_REWARDS",
            });
            return;
        }

        const balanceAsEther = formatEther(BigInt(balance.toString()));

        const traceId = message.id;
        const rewardsInUSDCWei = await getPrice(
            traceId,
            state.userId,
            balance.toString(),
            ETH_ADDRESS,
            ETH_TOKEN_DECIMALS,
            ETH,
            USDC_ADDRESS,
            USDC_TOKEN_DECIMALS,
            USDC,
        )

        const rewardsInUSDC = ethers.formatUnits(rewardsInUSDCWei, USDC_TOKEN_DECIMALS);
        
        await callback?.({
            text: `🎉 Congratulations! Your Senpi rewards balance from referrals and copy trades has grown to ${balanceAsEther} ETH, currently worth $${Number(rewardsInUSDC)}. Shall I go ahead and send it to your Senpi wallet?`,
            action: "CHECK_REWARDS",
        });
        
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "What rewards have I earned?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Your Senpi rewards balance from referrals and copy trades is 0.2421545 ETH, currently worth $579.23. Would you like me to send it to your Senpi wallet?",
                    action: "CLAIM_REWARDS",
                },
            },
        ],
    ] as ActionExample[][],
};
